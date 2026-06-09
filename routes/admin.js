const express = require('express');
const router = express.Router();
const { db, runQuery, getQuery, getOne, runTransaction, nowFormatted } = require('../database');

const VALID_STATUSES = ['待领出', '已领出', '待巡检', '维护中', '停用中', '恢复可用'];

router.post('/shifts', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: '班次名称不能为空' });
    }
    const result = await runQuery(
      'INSERT INTO shifts (name, description) VALUES (?, ?)',
      [String(name).trim(), description]
    );
    res.json({ id: result.id, name, description });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/shifts', async (req, res) => {
  try {
    const shifts = await getQuery('SELECT * FROM shifts ORDER BY id');
    res.json(shifts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/shifts/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: '班次名称不能为空' });
    }
    await runQuery(
      'UPDATE shifts SET name = ?, description = ? WHERE id = ?',
      [String(name).trim(), description, req.params.id]
    );
    const shift = await getOne('SELECT * FROM shifts WHERE id = ?', [req.params.id]);
    res.json(shift);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/shifts/:id', async (req, res) => {
  try {
    const referencedDrums = await getOne('SELECT COUNT(*) as count FROM drums WHERE shift_id = ?', [req.params.id]);
    if (referencedDrums.count > 0) {
      return res.status(400).json({ error: `该班次仍被 ${referencedDrums.count} 个鼓具引用，无法删除` });
    }
    await runQuery('DELETE FROM shifts WHERE id = ?', [req.params.id]);
    res.json({ message: 'Shift deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/positions', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: '位置名称不能为空' });
    }
    const result = await runQuery(
      'INSERT INTO rack_positions (name, description) VALUES (?, ?)',
      [String(name).trim(), description]
    );
    res.json({ id: result.id, name, description });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/positions', async (req, res) => {
  try {
    const positions = await getQuery('SELECT * FROM rack_positions ORDER BY id');
    res.json(positions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/positions/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: '位置名称不能为空' });
    }
    await runQuery(
      'UPDATE rack_positions SET name = ?, description = ? WHERE id = ?',
      [String(name).trim(), description, req.params.id]
    );
    const position = await getOne('SELECT * FROM rack_positions WHERE id = ?', [req.params.id]);
    res.json(position);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/positions/:id', async (req, res) => {
  try {
    const referencedDrums = await getOne('SELECT COUNT(*) as count FROM drums WHERE position_id = ?', [req.params.id]);
    if (referencedDrums.count > 0) {
      return res.status(400).json({ error: `该位置仍被 ${referencedDrums.count} 个鼓具引用，无法删除` });
    }
    await runQuery('DELETE FROM rack_positions WHERE id = ?', [req.params.id]);
    res.json({ message: 'Position deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/skins', async (req, res) => {
  try {
    const { batch_number, type, brand, purchase_date } = req.body;
    if (!batch_number || !String(batch_number).trim()) {
      return res.status(400).json({ error: '批次号不能为空' });
    }
    const result = await runQuery(
      'INSERT INTO drum_skins (batch_number, type, brand, purchase_date) VALUES (?, ?, ?, ?)',
      [String(batch_number).trim(), type, brand, purchase_date]
    );
    res.json({ id: result.id, batch_number, type, brand, purchase_date });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/skins', async (req, res) => {
  try {
    const skins = await getQuery('SELECT * FROM drum_skins ORDER BY id DESC');
    res.json(skins);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/skins/:id', async (req, res) => {
  try {
    const { batch_number, type, brand, purchase_date } = req.body;
    if (!batch_number || !String(batch_number).trim()) {
      return res.status(400).json({ error: '批次号不能为空' });
    }
    await runQuery(
      'UPDATE drum_skins SET batch_number = ?, type = ?, brand = ?, purchase_date = ? WHERE id = ?',
      [String(batch_number).trim(), type, brand, purchase_date, req.params.id]
    );
    const skin = await getOne('SELECT * FROM drum_skins WHERE id = ?', [req.params.id]);
    res.json(skin);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/skins/:id', async (req, res) => {
  try {
    const referencedDrums = await getOne('SELECT COUNT(*) as count FROM drums WHERE skin_id = ?', [req.params.id]);
    if (referencedDrums.count > 0) {
      return res.status(400).json({ error: `该鼓皮仍被 ${referencedDrums.count} 个鼓具引用，无法删除` });
    }
    const referencedMaintenance = await getOne('SELECT COUNT(*) as count FROM maintenance_records WHERE new_skin_id = ?', [req.params.id]);
    if (referencedMaintenance.count > 0) {
      return res.status(400).json({ error: `该鼓皮仍被 ${referencedMaintenance.count} 条维修记录引用，无法删除` });
    }
    await runQuery('DELETE FROM drum_skins WHERE id = ?', [req.params.id]);
    res.json({ message: 'Drum skin deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/drums', async (req, res) => {
  try {
    const { drum_number, name, type, size, skin_id, position_id, shift_id, inspection_interval_days } = req.body;
    if (!drum_number || !String(drum_number).trim()) {
      return res.status(400).json({ error: '鼓具编号不能为空' });
    }
    if (inspection_interval_days !== undefined && inspection_interval_days !== null) {
      const val = Number(inspection_interval_days);
      if (isNaN(val) || !Number.isInteger(val) || val < 1) {
        return res.status(400).json({ error: '巡检间隔天数必须为正整数' });
      }
    }
    const result = await runQuery(
      `INSERT INTO drums (drum_number, name, type, size, skin_id, position_id, shift_id, current_status, inspection_interval_days) 
       VALUES (?, ?, ?, ?, ?, ?, ?, '待领出', COALESCE(?, 7))`,
      [String(drum_number).trim(), name, type, size, skin_id, position_id, shift_id, inspection_interval_days]
    );
    const drum = await getOne(`
      SELECT d.*, 
             s.batch_number as skin_batch,
             p.name as position_name,
             sh.name as shift_name
      FROM drums d
      LEFT JOIN drum_skins s ON d.skin_id = s.id
      LEFT JOIN rack_positions p ON d.position_id = p.id
      LEFT JOIN shifts sh ON d.shift_id = sh.id
      WHERE d.id = ?
    `, [result.id]);
    res.json(drum);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/drums', async (req, res) => {
  try {
    const drums = await getQuery(`
      SELECT d.*, 
             s.batch_number as skin_batch,
             p.name as position_name,
             sh.name as shift_name,
             CASE 
               WHEN d.last_inspection_date IS NOT NULL 
               THEN DATE(d.last_inspection_date, '+' || d.inspection_interval_days || ' days')
               ELSE DATE('now', '+' || d.inspection_interval_days || ' days')
             END as next_inspection_date,
             CASE 
               WHEN d.wear_level BETWEEN 0 AND 3 THEN '轻微'
               WHEN d.wear_level BETWEEN 4 AND 6 THEN '中度'
               WHEN d.wear_level >= 7 THEN '严重'
               ELSE '未知'
             END as wear_severity_label
      FROM drums d
      LEFT JOIN drum_skins s ON d.skin_id = s.id
      LEFT JOIN rack_positions p ON d.position_id = p.id
      LEFT JOIN shifts sh ON d.shift_id = sh.id
      ORDER BY d.id DESC
    `);
    res.json(drums);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/drums/:id', async (req, res) => {
  try {
    const drum = await getOne(`
      SELECT d.*, 
             s.batch_number as skin_batch,
             p.name as position_name,
             sh.name as shift_name,
             CASE 
               WHEN d.last_inspection_date IS NOT NULL 
               THEN DATE(d.last_inspection_date, '+' || d.inspection_interval_days || ' days')
               ELSE DATE('now', '+' || d.inspection_interval_days || ' days')
             END as next_inspection_date,
             CASE 
               WHEN d.wear_level BETWEEN 0 AND 3 THEN '轻微'
               WHEN d.wear_level BETWEEN 4 AND 6 THEN '中度'
               WHEN d.wear_level >= 7 THEN '严重'
               ELSE '未知'
             END as wear_severity_label
      FROM drums d
      LEFT JOIN drum_skins s ON d.skin_id = s.id
      LEFT JOIN rack_positions p ON d.position_id = p.id
      LEFT JOIN shifts sh ON d.shift_id = sh.id
      WHERE d.id = ?
    `, [req.params.id]);
    if (!drum) {
      return res.status(404).json({ error: 'Drum not found' });
    }
    res.json(drum);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/drums/:id', async (req, res) => {
  try {
    const { drum_number, name, type, size, skin_id, position_id, shift_id, current_status, tension, wear_level, inspection_interval_days } = req.body;

    if (drum_number !== undefined && (!drum_number || !String(drum_number).trim())) {
      return res.status(400).json({ error: '鼓具编号不能为空' });
    }

    if (current_status !== undefined && current_status !== null) {
      if (!VALID_STATUSES.includes(current_status)) {
        return res.status(400).json({ error: `无效的状态值: ${current_status}，有效值为: ${VALID_STATUSES.join(', ')}` });
      }
    }

    if (wear_level !== undefined && wear_level !== null) {
      const wl = Number(wear_level);
      if (isNaN(wl) || !Number.isInteger(wl) || wl < 0 || wl > 10) {
        return res.status(400).json({ error: '磨损等级必须为0-10的整数' });
      }
    }

    if (inspection_interval_days !== undefined && inspection_interval_days !== null) {
      const val = Number(inspection_interval_days);
      if (isNaN(val) || !Number.isInteger(val) || val < 1) {
        return res.status(400).json({ error: '巡检间隔天数必须为正整数' });
      }
    }

    const existingDrum = await getOne('SELECT * FROM drums WHERE id = ?', [req.params.id]);
    if (!existingDrum) {
      return res.status(404).json({ error: 'Drum not found' });
    }

    if (current_status && current_status !== existingDrum.current_status) {
      if (existingDrum.current_status === '已领出' && current_status !== '已领出') {
        const activeUsage = await getOne('SELECT * FROM usage_records WHERE drum_id = ? AND return_time IS NULL', [req.params.id]);
        if (activeUsage) {
          return res.status(400).json({ error: '该鼓具存在未归还记录，不可手动修改状态' });
        }
      }
      if (existingDrum.current_status === '维护中' && current_status === '待领出') {
        const activeMaintenance = await getOne('SELECT COUNT(*) as count FROM maintenance_records WHERE drum_id = ? AND end_time IS NULL', [req.params.id]);
        if (activeMaintenance.count > 0) {
          return res.status(400).json({ error: '该鼓具存在未完成的维修记录，不可手动改为待领出' });
        }
      }
    }

    const updateTime = nowFormatted();

    await runQuery(
      `UPDATE drums 
       SET drum_number = ?, name = ?, type = ?, size = ?, skin_id = ?, position_id = ?, 
           shift_id = ?, current_status = ?, tension = ?, wear_level = ?, 
           inspection_interval_days = COALESCE(?, inspection_interval_days),
           updated_at = ?
       WHERE id = ?`,
      [drum_number, name, type, size, skin_id, position_id, shift_id, current_status, tension, wear_level, inspection_interval_days, updateTime, req.params.id]
    );
    const drum = await getOne(`
      SELECT d.*, 
             s.batch_number as skin_batch,
             p.name as position_name,
             sh.name as shift_name
      FROM drums d
      LEFT JOIN drum_skins s ON d.skin_id = s.id
      LEFT JOIN rack_positions p ON d.position_id = p.id
      LEFT JOIN shifts sh ON d.shift_id = sh.id
      WHERE d.id = ?
    `, [req.params.id]);
    res.json(drum);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/drums/:id', async (req, res) => {
  try {
    const drum = await getOne('SELECT * FROM drums WHERE id = ?', [req.params.id]);
    if (!drum) {
      return res.status(404).json({ error: 'Drum not found' });
    }

    const activeUsage = await getOne('SELECT COUNT(*) as count FROM usage_records WHERE drum_id = ? AND return_time IS NULL', [req.params.id]);
    if (activeUsage.count > 0) {
      return res.status(400).json({ error: '该鼓具存在未归还记录，无法删除' });
    }

    const activeMaintenance = await getOne('SELECT COUNT(*) as count FROM maintenance_records WHERE drum_id = ? AND end_time IS NULL', [req.params.id]);
    if (activeMaintenance.count > 0) {
      return res.status(400).json({ error: '该鼓具存在未完成的维修记录，无法删除' });
    }

    const pendingDeactivation = await getOne('SELECT COUNT(*) as count FROM deactivation_requests WHERE drum_id = ? AND approved = 0', [req.params.id]);
    if (pendingDeactivation.count > 0) {
      return res.status(400).json({ error: '该鼓具存在待审批的停用申请，无法删除' });
    }

    const pendingExtension = await getOne(`
      SELECT COUNT(*) as count FROM extension_requests e
      JOIN usage_records u ON e.usage_record_id = u.id
      WHERE e.drum_id = ? AND e.approval_status = 'pending' AND u.return_time IS NULL
    `, [req.params.id]);
    if (pendingExtension.count > 0) {
      return res.status(400).json({ error: '该鼓具存在待审批的延期申请，无法删除' });
    }

    await runQuery('DELETE FROM drums WHERE id = ?', [req.params.id]);
    res.json({ message: 'Drum deleted' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/maintenance', async (req, res) => {
  try {
    const records = await getQuery(`
      SELECT m.*, d.drum_number, d.name as drum_name,
             s.batch_number as new_skin_batch
      FROM maintenance_records m
      JOIN drums d ON m.drum_id = d.id
      LEFT JOIN drum_skins s ON m.new_skin_id = s.id
      ORDER BY m.created_at DESC
    `);
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/maintenance/:id/complete', async (req, res) => {
  try {
    const { notes, reinspected } = req.body;
    const recordBefore = await getOne('SELECT * FROM maintenance_records WHERE id = ?', [req.params.id]);
    if (!recordBefore) {
      return res.status(404).json({ error: 'Maintenance record not found' });
    }

    if (recordBefore.end_time) {
      return res.status(400).json({ error: '该维修记录已完成，不可重复操作' });
    }

    const shouldMarkReinspected = reinspected === true || recordBefore.need_reinspection === 0;
    const completeTime = nowFormatted();

    await runTransaction(async () => {
      await runQuery(
        `UPDATE maintenance_records 
         SET end_time = ?, 
             notes = COALESCE(?, notes),
             reinspected = ?,
             reinspection_date = CASE WHEN ? = 1 THEN ? ELSE reinspection_date END
         WHERE id = ?`,
        [completeTime, notes, shouldMarkReinspected ? 1 : 0, shouldMarkReinspected ? 1 : 0, completeTime, req.params.id]
      );

      const record = await getOne('SELECT * FROM maintenance_records WHERE id = ?', [req.params.id]);

      const otherActiveMaintenance = await getOne(
        'SELECT COUNT(*) as count FROM maintenance_records WHERE drum_id = ? AND end_time IS NULL AND id != ?',
        [record.drum_id, req.params.id]
      );

      if (record.need_reinspection === 1 && record.reinspected === 0) {
        await runQuery('UPDATE drums SET current_status = ?, updated_at = ? WHERE id = ?', ['待巡检', completeTime, record.drum_id]);
      } else if (otherActiveMaintenance.count === 0) {
        await runQuery('UPDATE drums SET current_status = ?, updated_at = ? WHERE id = ?', ['待领出', completeTime, record.drum_id]);
      }
    });

    const record = await getOne('SELECT * FROM maintenance_records WHERE id = ?', [req.params.id]);

    res.json({ 
      message: 'Maintenance completed', 
      record,
      auto_reinspected: shouldMarkReinspected && recordBefore.need_reinspection === 0
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/extension/:id/approve', async (req, res) => {
  try {
    const { approved_by, approval_notes } = req.body;

    if (!approved_by || !String(approved_by).trim()) {
      return res.status(400).json({ error: '缺少审批人信息: approved_by' });
    }

    const request = await getOne('SELECT * FROM extension_requests WHERE id = ?', [req.params.id]);
    if (!request) {
      return res.status(404).json({ error: '延期申请不存在' });
    }

    if (request.approval_status !== 'pending') {
      return res.status(400).json({ error: `该申请已被${request.approval_status === 'approved' ? '批准' : '拒绝'}，不可重复审批` });
    }

    const usageRecord = await getOne('SELECT * FROM usage_records WHERE id = ?', [request.usage_record_id]);
    if (!usageRecord) {
      return res.status(404).json({ error: '关联的使用记录不存在' });
    }

    if (usageRecord.return_time !== null) {
      return res.status(400).json({ error: '该鼓具已归还，无法审批延期' });
    }

    const approveTime = nowFormatted();

    await runTransaction(async () => {
      await runQuery(
        `UPDATE extension_requests 
         SET approval_status = 'approved', 
             approved_by = ?, 
             approved_at = ?,
             approval_notes = ?,
             new_expected_return_time = ?
         WHERE id = ?`,
        [approved_by, approveTime, approval_notes, request.new_expected_return_time, req.params.id]
      );

      await runQuery(
        `UPDATE usage_records 
         SET expected_return_time = CASE 
           WHEN ? > expected_return_time THEN ?
           ELSE expected_return_time
         END
         WHERE id = ?`,
        [request.new_expected_return_time, request.new_expected_return_time, request.usage_record_id]
      );
    });

    const updatedRequest = await getOne(`
      SELECT e.*, d.drum_number, d.name as drum_name, u.expected_return_time as current_expected_return_time
      FROM extension_requests e
      JOIN drums d ON e.drum_id = d.id
      JOIN usage_records u ON e.usage_record_id = u.id
      WHERE e.id = ?
    `, [req.params.id]);

    res.json({
      message: '延期申请已批准，预计归还时间已更新',
      extension: updatedRequest
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/extension/:id/reject', async (req, res) => {
  try {
    const { approved_by, approval_notes } = req.body;

    if (!approved_by || !String(approved_by).trim()) {
      return res.status(400).json({ error: '缺少审批人信息: approved_by' });
    }

    const request = await getOne('SELECT * FROM extension_requests WHERE id = ?', [req.params.id]);
    if (!request) {
      return res.status(404).json({ error: '延期申请不存在' });
    }

    if (request.approval_status !== 'pending') {
      return res.status(400).json({ error: `该申请已被${request.approval_status === 'approved' ? '批准' : '拒绝'}，不可重复审批` });
    }

    const rejectTime = nowFormatted();

    await runQuery(
      `UPDATE extension_requests 
       SET approval_status = 'rejected', 
           approved_by = ?, 
           approved_at = ?,
           approval_notes = ?
       WHERE id = ?`,
      [approved_by, rejectTime, approval_notes, req.params.id]
    );

    const updatedRequest = await getOne(`
      SELECT e.*, d.drum_number, d.name as drum_name, u.expected_return_time as current_expected_return_time
      FROM extension_requests e
      JOIN drums d ON e.drum_id = d.id
      JOIN usage_records u ON e.usage_record_id = u.id
      WHERE e.id = ?
    `, [req.params.id]);

    res.json({
      message: '延期申请已拒绝',
      extension: updatedRequest
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/extension-requests', async (req, res) => {
  try {
    const { drum_id, staff_name, approval_status } = req.query;

    let sql = `
      SELECT e.*, d.drum_number, d.name as drum_name, u.expected_return_time as current_expected_return_time,
             u.staff_name as borrower, u.purpose
      FROM extension_requests e
      JOIN drums d ON e.drum_id = d.id
      JOIN usage_records u ON e.usage_record_id = u.id
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
