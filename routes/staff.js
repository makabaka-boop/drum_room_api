const express = require('express');
const router = express.Router();
const { db } = require('../database');

const runQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const getQuery = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const getOne = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const VALID_STATUSES = ['待领出', '已领出', '待巡检', '维护中', '停用中', '恢复可用'];
const OVERDUE_HOURS = 24;

router.post('/checkout', async (req, res) => {
  try {
    const { drum_id, staff_name, shift_id, purpose, expected_return_hours } = req.body;
    
    const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drum_id]);
    if (!drum) {
      return res.status(404).json({ error: 'Drum not found' });
    }
    
    if (drum.current_status === '已领出') {
      return res.status(400).json({ error: '该鼓具已被领出，不可重复借出' });
    }
    
    if (!['待领出', '恢复可用'].includes(drum.current_status)) {
      return res.status(400).json({ error: `当前状态为"${drum.current_status}"，不可领出` });
    }
    
    const activeUsage = await getOne(`
      SELECT * FROM usage_records 
      WHERE drum_id = ? AND return_time IS NULL
    `, [drum_id]);
    
    if (activeUsage) {
      return res.status(400).json({ error: '该鼓具存在未归还记录，请先确认归位' });
    }
    
    const expectedReturnHours = expected_return_hours || 4;
    const expectedReturnTime = new Date(Date.now() + expectedReturnHours * 60 * 60 * 1000).toISOString();
    
    await runQuery(
      `INSERT INTO usage_records 
       (drum_id, staff_name, shift_id, purpose, checkout_time, expected_return_time, tension_before, wear_before)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)`,
      [drum_id, staff_name, shift_id, purpose, expectedReturnTime, drum.tension, drum.wear_level]
    );
    
    await runQuery(
      `UPDATE drums SET current_status = '已领出', total_uses = total_uses + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [drum_id]
    );
    
    const updatedDrum = await getOne(`
      SELECT d.*, 
             s.batch_number as skin_batch,
             p.name as position_name,
             sh.name as shift_name
      FROM drums d
      LEFT JOIN drum_skins s ON d.skin_id = s.id
      LEFT JOIN rack_positions p ON d.position_id = p.id
      LEFT JOIN shifts sh ON d.shift_id = sh.id
      WHERE d.id = ?
    `, [drum_id]);
    
    res.json({ message: '领出成功', drum: updatedDrum });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/return', async (req, res) => {
  try {
    const { drum_id, staff_name, tension_after, wear_after, edge_wear, notes } = req.body;
    
    const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drum_id]);
    if (!drum) {
      return res.status(404).json({ error: 'Drum not found' });
    }
    
    if (drum.current_status !== '已领出') {
      return res.status(400).json({ error: `当前状态为"${drum.current_status}"，不可执行归位操作` });
    }
    
    const usageRecord = await getOne(`
      SELECT * FROM usage_records 
      WHERE drum_id = ? AND return_time IS NULL
      ORDER BY checkout_time DESC LIMIT 1
    `, [drum_id]);
    
    if (!usageRecord) {
      return res.status(400).json({ error: '未找到对应的领出记录' });
    }
    
    let is_overdue = 0;
    if (usageRecord.expected_return_time) {
      const expectedTime = new Date(usageRecord.expected_return_time);
      const now = new Date();
      if (now > expectedTime) {
        is_overdue = 1;
      }
    }
    
    await runQuery(
      `UPDATE usage_records 
       SET return_time = CURRENT_TIMESTAMP, 
           tension_after = ?, 
           wear_after = ?, 
           edge_wear = ?, 
           notes = ?,
           is_overdue = ?
       WHERE id = ?`,
      [tension_after, wear_after, edge_wear, notes, is_overdue, usageRecord.id]
    );
    
    const newStatus = (wear_after && wear_after >= 7) ? '待巡检' : '待领出';
    
    await runQuery(
      `UPDATE drums 
       SET current_status = ?, tension = ?, wear_level = ?, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [newStatus, tension_after, wear_after || drum.wear_level, drum_id]
    );
    
    const updatedDrum = await getOne(`
      SELECT d.*, 
             s.batch_number as skin_batch,
             p.name as position_name,
             sh.name as shift_name
      FROM drums d
      LEFT JOIN drum_skins s ON d.skin_id = s.id
      LEFT JOIN rack_positions p ON d.position_id = p.id
      LEFT JOIN shifts sh ON d.shift_id = sh.id
      WHERE d.id = ?
    `, [drum_id]);
    
    res.json({ 
      message: '归位成功', 
      is_overdue: is_overdue === 1,
      needs_inspection: newStatus === '待巡检',
      drum: updatedDrum 
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/inspect', async (req, res) => {
  try {
    const { drum_id, staff_name, shift_id, tension, wear_level, edge_wear, needs_repair, repair_notes, notes, force } = req.body;
    
    const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drum_id]);
    if (!drum) {
      return res.status(404).json({ error: 'Drum not found' });
    }
    
    const warnings = [];
    let inspectionTiming = null;
    const now = new Date();
    const intervalDays = drum.inspection_interval_days || 7;
    
    if (drum.last_inspection_date) {
      const lastInspect = new Date(drum.last_inspection_date);
      const daysSinceLast = Math.floor((now - lastInspect) / (1000 * 60 * 60 * 24));
      const expectedNext = new Date(lastInspect.getTime() + intervalDays * 24 * 60 * 60 * 1000);
      const daysUntilNext = Math.ceil((expectedNext - now) / (1000 * 60 * 60 * 24));
      
      if (daysUntilNext > 1 && drum.current_status !== '待巡检' && !force) {
        return res.status(400).json({ 
          error: '还未到巡检节点',
          details: {
            last_inspection: drum.last_inspection_date,
            interval_days: intervalDays,
            days_since_last: daysSinceLast,
            days_until_next: daysUntilNext,
            suggestion: '如需提前巡检，请传入 force: true 参数'
          }
        });
      }
      
      if (daysUntilNext > 1) {
        warnings.push(`提前${daysUntilNext}天巡检，距上次巡检${daysSinceLast}天`);
        inspectionTiming = 'early';
      } else if (daysUntilNext <= 0) {
        inspectionTiming = 'overdue';
        if (daysUntilNext < -2) {
          warnings.push(`巡检已超期${Math.abs(daysUntilNext)}天`);
        }
      } else {
        inspectionTiming = 'on_time';
      }
    } else {
      inspectionTiming = 'first';
      warnings.push('首次巡检');
    }
    
    if (drum.current_status !== '待巡检' && drum.current_status !== '恢复可用') {
      warnings.push(`当前状态为"${drum.current_status}"，非待巡检状态`);
    }
    
    const pendingMaintenance = await getQuery(`
      SELECT * FROM maintenance_records 
      WHERE drum_id = ? AND need_reinspection = 1 AND reinspected = 0
      ORDER BY created_at DESC
    `, [drum_id]);
    
    await runQuery(
      `INSERT INTO inspection_records 
       (drum_id, staff_name, shift_id, tension, wear_level, edge_wear, needs_repair, repair_notes, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [drum_id, staff_name, shift_id, tension, wear_level, edge_wear, needs_repair ? 1 : 0, repair_notes, notes]
    );
    
    if (pendingMaintenance.length > 0) {
      await runQuery(
        `UPDATE maintenance_records 
         SET reinspected = 1, reinspection_date = CURRENT_TIMESTAMP
         WHERE drum_id = ? AND need_reinspection = 1 AND reinspected = 0`,
        [drum_id]
      );
    }
    
    let newStatus = drum.current_status;
    if (needs_repair) {
      newStatus = '维护中';
    } else if (drum.current_status === '待巡检' || drum.current_status === '恢复可用') {
      newStatus = '待领出';
    }
    
    await runQuery(
      `UPDATE drums 
       SET current_status = ?, tension = ?, wear_level = ?, 
           last_inspection_date = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [newStatus, tension || drum.tension, wear_level !== undefined ? wear_level : drum.wear_level, drum_id]
    );
    
    const updatedDrum = await getOne(`
      SELECT d.*, 
             s.batch_number as skin_batch,
             p.name as position_name,
             sh.name as shift_name
      FROM drums d
      LEFT JOIN drum_skins s ON d.skin_id = s.id
      LEFT JOIN rack_positions p ON d.position_id = p.id
      LEFT JOIN shifts sh ON d.shift_id = sh.id
      WHERE d.id = ?
    `, [drum_id]);
    
    if (needs_repair) {
      await runQuery(
        `INSERT INTO maintenance_records 
         (drum_id, staff_name, type, description, need_reinspection)
         VALUES (?, ?, '巡检报修', ?, 1)`,
        [drum_id, staff_name, repair_notes || '巡检发现需要维修']
      );
    }
    
    res.json({ 
      message: '巡检记录已保存', 
      needs_maintenance: needs_repair,
      reinspected_maintenance: pendingMaintenance.length,
      inspection_timing: inspectionTiming,
      warnings: warnings,
      drum: updatedDrum 
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/repair', async (req, res) => {
  try {
    const { drum_id, staff_name, description, skin_replaced, new_skin_id, need_reinspection } = req.body;
    
    const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drum_id]);
    if (!drum) {
      return res.status(404).json({ error: 'Drum not found' });
    }
    
    const result = await runQuery(
      `INSERT INTO maintenance_records 
       (drum_id, staff_name, type, description, skin_replaced, new_skin_id, need_reinspection)
       VALUES (?, ?, '补皮/维修', ?, ?, ?, ?)`,
      [drum_id, staff_name, description, skin_replaced ? 1 : 0, new_skin_id, need_reinspection ? 1 : 0]
    );
    
    if (skin_replaced && new_skin_id) {
      await runQuery(
        `UPDATE drums SET skin_id = ?, wear_level = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [new_skin_id, drum_id]
      );
    }
    
    await runQuery(
      `UPDATE drums SET current_status = '维护中', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [drum_id]
    );
    
    const maintenanceRecord = await getOne('SELECT * FROM maintenance_records WHERE id = ?', [result.id]);
    
    res.json({ 
      message: '补皮/维修记录已创建', 
      maintenance: maintenanceRecord,
      need_reinspection: need_reinspection
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/deactivate', async (req, res) => {
  try {
    const { drum_id, staff_name, reason } = req.body;
    
    const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drum_id]);
    if (!drum) {
      return res.status(404).json({ error: 'Drum not found' });
    }
    
    if (drum.current_status === '停用中') {
      return res.status(400).json({ error: '该鼓具已处于停用状态' });
    }
    
    const result = await runQuery(
      `INSERT INTO deactivation_requests (drum_id, staff_name, reason) VALUES (?, ?, ?)`,
      [drum_id, staff_name, reason]
    );
    
    res.json({ 
      message: '停用申请已提交，等待审批', 
      request_id: result.id 
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/deactivate/:id/approve', async (req, res) => {
  try {
    const { approved_by } = req.body;
    
    const request = await getOne('SELECT * FROM deactivation_requests WHERE id = ?', [req.params.id]);
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    if (request.approved === 1) {
      return res.status(400).json({ error: '该申请已审批' });
    }
    
    await runQuery(
      `UPDATE deactivation_requests 
       SET approved = 1, approved_by = ?, approved_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [approved_by, req.params.id]
    );
    
    await runQuery(
      `UPDATE drums SET current_status = '停用中', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [request.drum_id]
    );
    
    res.json({ message: '停用申请已批准，鼓具已停用' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/reactivate', async (req, res) => {
  try {
    const { drum_id, staff_name } = req.body;
    
    const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drum_id]);
    if (!drum) {
      return res.status(404).json({ error: 'Drum not found' });
    }
    
    if (drum.current_status !== '停用中') {
      return res.status(400).json({ error: `当前状态为"${drum.current_status}"，不可恢复` });
    }
    
    await runQuery(
      `UPDATE drums SET current_status = '恢复可用', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [drum_id]
    );
    
    await runQuery(
      `INSERT INTO inspection_records 
       (drum_id, staff_name, tension, wear_level, notes)
       VALUES (?, ?, ?, ?, '停用恢复，建议进行全面检查')`,
      [drum_id, staff_name, drum.tension, drum.wear_level]
    );
    
    const updatedDrum = await getOne(`
      SELECT d.*, 
             s.batch_number as skin_batch,
             p.name as position_name,
             sh.name as shift_name
      FROM drums d
      LEFT JOIN drum_skins s ON d.skin_id = s.id
      LEFT JOIN rack_positions p ON d.position_id = p.id
      LEFT JOIN shifts sh ON d.shift_id = sh.id
      WHERE d.id = ?
    `, [drum_id]);
    
    res.json({ message: '鼓具已恢复可用，建议进行全面检查', drum: updatedDrum });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/usage-records', async (req, res) => {
  try {
    const records = await getQuery(`
      SELECT u.*, d.drum_number, d.name as drum_name, sh.name as shift_name
      FROM usage_records u
      JOIN drums d ON u.drum_id = d.id
      LEFT JOIN shifts sh ON u.shift_id = sh.id
      ORDER BY u.checkout_time DESC
      LIMIT 100
    `);
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/inspection-records', async (req, res) => {
  try {
    const records = await getQuery(`
      SELECT i.*, d.drum_number, d.name as drum_name, sh.name as shift_name
      FROM inspection_records i
      JOIN drums d ON i.drum_id = d.id
      LEFT JOIN shifts sh ON i.shift_id = sh.id
      ORDER BY i.created_at DESC
      LIMIT 100
    `);
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/extension', async (req, res) => {
  try {
    const { drum_id, staff_name, extension_hours, reason } = req.body;

    if (!drum_id || !staff_name || !extension_hours || !reason) {
      return res.status(400).json({ error: '缺少必要参数: drum_id, staff_name, extension_hours, reason' });
    }

    if (extension_hours <= 0) {
      return res.status(400).json({ error: '延期时长必须大于0小时' });
    }

    const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drum_id]);
    if (!drum) {
      return res.status(404).json({ error: '鼓具不存在' });
    }

    if (drum.current_status !== '已领出') {
      return res.status(400).json({ error: `当前状态为"${drum.current_status}"，不可申请延期` });
    }

    const usageRecord = await getOne(`
      SELECT * FROM usage_records
      WHERE drum_id = ? AND return_time IS NULL
      ORDER BY checkout_time DESC LIMIT 1
    `, [drum_id]);

    if (!usageRecord) {
      return res.status(400).json({ error: '未找到对应的领出记录' });
    }

    if (usageRecord.staff_name !== staff_name) {
      return res.status(403).json({ 
        error: '只有领用人本人才能申请延期', 
        details: {
          borrower: usageRecord.staff_name,
          applicant: staff_name
        }
      });
    }

    const pendingExtension = await getOne(`
      SELECT * FROM extension_requests
      WHERE usage_record_id = ? AND approval_status = 'pending'
    `, [usageRecord.id]);

    if (pendingExtension) {
      return res.status(400).json({ error: '该借用已有待审批的延期申请，请等待审批' });
    }

    const originalExpectedReturn = usageRecord.expected_return_time;
    const newExpectedReturn = new Date(new Date(originalExpectedReturn).getTime() + extension_hours * 60 * 60 * 1000).toISOString();

    const result = await runQuery(
      `INSERT INTO extension_requests
       (usage_record_id, drum_id, staff_name, extension_hours, reason, original_expected_return_time, new_expected_return_time)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [usageRecord.id, drum_id, staff_name, extension_hours, reason, originalExpectedReturn, newExpectedReturn]
    );

    const extensionRecord = await getOne(`
      SELECT e.*, d.drum_number, d.name as drum_name, u.expected_return_time as current_expected_return_time
      FROM extension_requests e
      JOIN drums d ON e.drum_id = d.id
      JOIN usage_records u ON e.usage_record_id = u.id
      WHERE e.id = ?
    `, [result.id]);

    res.json({
      message: '延期申请已提交，等待审批',
      request_id: result.id,
      extension: extensionRecord
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/extension-records', async (req, res) => {
  try {
    const { drum_id, staff_name, approval_status } = req.query;

    let sql = `
      SELECT e.*, d.drum_number, d.name as drum_name, u.expected_return_time as current_expected_return_time,
             sh.name as shift_name, u.staff_name as borrower,
             CASE e.approval_status
               WHEN 'pending' THEN '待审批'
               WHEN 'approved' THEN '已同意'
               WHEN 'rejected' THEN '已拒绝'
               ELSE e.approval_status
             END as approval_status_label
      FROM extension_requests e
      JOIN drums d ON e.drum_id = d.id
      JOIN usage_records u ON e.usage_record_id = u.id
      LEFT JOIN shifts sh ON u.shift_id = sh.id
      WHERE 1=1
    `;
    let params = [];

    if (drum_id) {
      sql += ` AND e.drum_id = ?`;
      params.push(drum_id);
    }

    if (staff_name) {
      sql += ` AND e.staff_name LIKE ?`;
      params.push(`%${staff_name}%`);
    }

    if (approval_status) {
      sql += ` AND e.approval_status = ?`;
      params.push(approval_status);
    }

    sql += ` ORDER BY e.created_at DESC LIMIT 200`;

    const records = await getQuery(sql, params);
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
