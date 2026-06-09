const express = require('express');
const router = express.Router();
const { 
  runQuery, 
  getQuery, 
  getOne, 
  withTransaction,
  VALID_STATUSES,
  isValidStatus,
  validatePositiveInteger,
  validateRequiredString,
  validateWearLevel,
  getCurrentTimeISO
} = require('../database');

const OVERDUE_HOURS = 24;

router.post('/checkout', async (req, res) => {
  try {
    const { drum_id, staff_name, shift_id, purpose, expected_return_hours } = req.body;
    
    const drumId = validatePositiveInteger(drum_id, '鼓具ID');
    const staffName = validateRequiredString(staff_name, '领用人姓名');
    const expectedReturnHours = expected_return_hours !== undefined 
      ? validatePositiveInteger(expected_return_hours, '预计归还时长') 
      : 4;
    
    if (expectedReturnHours <= 0 || expectedReturnHours > 168) {
      return res.status(400).json({ error: '预计归还时长必须在 1-168 小时之间' });
    }
    
    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
      if (!drum) {
        throw new Error('鼓具不存在');
      }
      
      if (drum.current_status === '已领出') {
        throw new Error('该鼓具已被领出，不可重复借出');
      }
      
      if (!['待领出', '恢复可用'].includes(drum.current_status)) {
        throw new Error(`当前状态为"${drum.current_status}"，不可领出`);
      }
      
      const activeUsage = await getOne(`
        SELECT * FROM usage_records 
        WHERE drum_id = ? AND return_time IS NULL
      `, [drumId]);
      
      if (activeUsage) {
        throw new Error('该鼓具存在未归还记录，请先确认归位');
      }
      
      const expectedReturnTime = new Date(Date.now() + expectedReturnHours * 60 * 60 * 1000).toISOString();
      
      await runQuery(
        `INSERT INTO usage_records 
         (drum_id, staff_name, shift_id, purpose, checkout_time, expected_return_time, tension_before, wear_before)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [drumId, staffName, shift_id || null, purpose || null, expectedReturnTime, expectedReturnTime, drum.tension, drum.wear_level]
      );
      
      await runQuery(
        `UPDATE drums SET current_status = '已领出', total_uses = total_uses + 1, updated_at = ? WHERE id = ?`,
        [getCurrentTimeISO(), drumId]
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
      `, [drumId]);
      
      return updatedDrum;
    });
    
    res.json({ message: '领出成功', drum: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/return', async (req, res) => {
  try {
    const { drum_id, staff_name, tension_after, wear_after, edge_wear, notes } = req.body;
    
    const drumId = validatePositiveInteger(drum_id, '鼓具ID');
    const staffName = validateRequiredString(staff_name, '归还人姓名');
    
    const wearAfter = wear_after !== undefined 
      ? validateWearLevel(wear_after, '归还后磨损等级') 
      : undefined;
    
    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
      if (!drum) {
        throw new Error('鼓具不存在');
      }
      
      if (drum.current_status !== '已领出') {
        throw new Error(`当前状态为"${drum.current_status}"，不可执行归位操作`);
      }
      
      const usageRecord = await getOne(`
        SELECT * FROM usage_records 
        WHERE drum_id = ? AND return_time IS NULL
        ORDER BY checkout_time DESC LIMIT 1
      `, [drumId]);
      
      if (!usageRecord) {
        throw new Error('未找到对应的领出记录');
      }
      
      let is_overdue = 0;
      if (usageRecord.expected_return_time) {
        const expectedTime = new Date(usageRecord.expected_return_time);
        const now = new Date();
        if (now > expectedTime) {
          is_overdue = 1;
        }
      }
      
      const returnTime = getCurrentTimeISO();
      
      await runQuery(
        `UPDATE usage_records 
         SET return_time = ?, 
             tension_after = ?, 
             wear_after = ?, 
             edge_wear = ?, 
             notes = ?,
             is_overdue = ?
         WHERE id = ?`,
        [returnTime, tension_after || null, wearAfter !== undefined ? wearAfter : null, edge_wear || null, notes || null, is_overdue, usageRecord.id]
      );
      
      const finalWearLevel = wearAfter !== undefined ? wearAfter : drum.wear_level;
      const newStatus = finalWearLevel >= 7 ? '待巡检' : '待领出';
      
      await runQuery(
        `UPDATE drums 
         SET current_status = ?, tension = ?, wear_level = ?, updated_at = ? 
         WHERE id = ?`,
        [newStatus, tension_after || drum.tension, finalWearLevel, returnTime, drumId]
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
      `, [drumId]);
      
      return {
        is_overdue: is_overdue === 1,
        needs_inspection: newStatus === '待巡检',
        drum: updatedDrum
      };
    });
    
    res.json({ 
      message: '归位成功', 
      ...result
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/inspect', async (req, res) => {
  try {
    const { drum_id, staff_name, shift_id, tension, wear_level, edge_wear, needs_repair, repair_notes, notes, force } = req.body;
    
    const drumId = validatePositiveInteger(drum_id, '鼓具ID');
    const staffName = validateRequiredString(staff_name, '巡检人姓名');
    const wearLevel = wear_level !== undefined ? validateWearLevel(wear_level, '巡检磨损等级') : undefined;
    
    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
      if (!drum) {
        throw new Error('鼓具不存在');
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
          const error = new Error('还未到巡检节点');
          error.details = {
            last_inspection: drum.last_inspection_date,
            interval_days: intervalDays,
            days_since_last: daysSinceLast,
            days_until_next: daysUntilNext,
            suggestion: '如需提前巡检，请传入 force: true 参数'
          };
          throw error;
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
      `, [drumId]);
      
      const inspectionTime = getCurrentTimeISO();
      
      await runQuery(
        `INSERT INTO inspection_records 
         (drum_id, staff_name, shift_id, tension, wear_level, edge_wear, needs_repair, repair_notes, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [drumId, staffName, shift_id || null, tension || null, wearLevel !== undefined ? wearLevel : null, 
         edge_wear || null, needs_repair ? 1 : 0, repair_notes || null, notes || null, inspectionTime]
      );
      
      if (pendingMaintenance.length > 0) {
        await runQuery(
          `UPDATE maintenance_records 
           SET reinspected = 1, reinspection_date = ?
           WHERE drum_id = ? AND need_reinspection = 1 AND reinspected = 0`,
          [inspectionTime, drumId]
        );
      }
      
      let newStatus = drum.current_status;
      if (needs_repair) {
        newStatus = '维护中';
      } else if (drum.current_status === '待巡检' || drum.current_status === '恢复可用') {
        newStatus = '待领出';
      }
      
      const finalTension = tension !== undefined ? tension : drum.tension;
      const finalWear = wearLevel !== undefined ? wearLevel : drum.wear_level;
      
      await runQuery(
        `UPDATE drums 
         SET current_status = ?, tension = ?, wear_level = ?, 
             last_inspection_date = ?, updated_at = ? 
         WHERE id = ?`,
        [newStatus, finalTension, finalWear, inspectionTime, inspectionTime, drumId]
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
      `, [drumId]);
      
      let maintenanceRecord = null;
      if (needs_repair) {
        const maintResult = await runQuery(
          `INSERT INTO maintenance_records 
           (drum_id, staff_name, type, description, need_reinspection, start_time)
           VALUES (?, ?, '巡检报修', ?, 1, ?)`,
          [drumId, staffName, repair_notes || '巡检发现需要维修', inspectionTime]
        );
        maintenanceRecord = await getOne('SELECT * FROM maintenance_records WHERE id = ?', [maintResult.id]);
      }
      
      return {
        needs_maintenance: needs_repair,
        reinspected_maintenance: pendingMaintenance.length,
        inspection_timing: inspectionTiming,
        warnings: warnings,
        drum: updatedDrum,
        maintenance: maintenanceRecord
      };
    });
    
    res.json({ 
      message: '巡检记录已保存', 
      ...result
    });
  } catch (err) {
    if (err.details) {
      res.status(400).json({ error: err.message, details: err.details });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

router.post('/repair', async (req, res) => {
  try {
    const { drum_id, staff_name, description, skin_replaced, new_skin_id, need_reinspection } = req.body;
    
    const drumId = validatePositiveInteger(drum_id, '鼓具ID');
    const staffName = validateRequiredString(staff_name, '维修人姓名');
    
    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
      if (!drum) {
        throw new Error('鼓具不存在');
      }
      
      if (skin_replaced && new_skin_id) {
        const skin = await getOne('SELECT * FROM drum_skins WHERE id = ?', [new_skin_id]);
        if (!skin) {
          throw new Error('指定的鼓皮不存在');
        }
      }
      
      const repairTime = getCurrentTimeISO();
      
      const maintResult = await runQuery(
        `INSERT INTO maintenance_records 
         (drum_id, staff_name, type, description, skin_replaced, new_skin_id, need_reinspection, start_time)
         VALUES (?, ?, '补皮/维修', ?, ?, ?, ?, ?)`,
        [drumId, staffName, description || null, skin_replaced ? 1 : 0, 
         new_skin_id || null, need_reinspection ? 1 : 0, repairTime]
      );
      
      if (skin_replaced && new_skin_id) {
        await runQuery(
          `UPDATE drums SET skin_id = ?, wear_level = 0, updated_at = ? WHERE id = ?`,
          [new_skin_id, repairTime, drumId]
        );
      }
      
      await runQuery(
        `UPDATE drums SET current_status = '维护中', updated_at = ? WHERE id = ?`,
        [repairTime, drumId]
      );
      
      const maintenanceRecord = await getOne('SELECT * FROM maintenance_records WHERE id = ?', [maintResult.id]);
      
      return {
        maintenance: maintenanceRecord,
        need_reinspection: need_reinspection
      };
    });
    
    res.json({ 
      message: '补皮/维修记录已创建', 
      ...result
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/deactivate', async (req, res) => {
  try {
    const { drum_id, staff_name, reason } = req.body;
    
    const drumId = validatePositiveInteger(drum_id, '鼓具ID');
    const staffName = validateRequiredString(staff_name, '申请人姓名');
    const reasonText = validateRequiredString(reason, '停用原因', 500);
    
    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
      if (!drum) {
        throw new Error('鼓具不存在');
      }
      
      if (drum.current_status === '停用中') {
        throw new Error('该鼓具已处于停用状态');
      }
      
      if (drum.current_status === '已领出') {
        throw new Error('该鼓具正在使用中，不可申请停用');
      }
      
      if (drum.current_status === '维护中') {
        throw new Error('该鼓具正在维护中，不可申请停用');
      }
      
      const pendingRequest = await getOne(`
        SELECT * FROM deactivation_requests 
        WHERE drum_id = ? AND approved = 0
      `, [drumId]);
      
      if (pendingRequest) {
        throw new Error('该鼓具已有待审批的停用申请，请等待审批');
      }
      
      const pendingMaintenance = await getOne(`
        SELECT * FROM maintenance_records 
        WHERE drum_id = ? AND end_time IS NULL
      `, [drumId]);
      
      if (pendingMaintenance) {
        throw new Error('该鼓具有进行中的维修任务，不可申请停用');
      }
      
      const requestResult = await runQuery(
        `INSERT INTO deactivation_requests (drum_id, staff_name, reason) VALUES (?, ?, ?)`,
        [drumId, staffName, reasonText]
      );
      
      return { request_id: requestResult.id };
    });
    
    res.json({ 
      message: '停用申请已提交，等待审批', 
      ...result
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/deactivate/:id/approve', async (req, res) => {
  try {
    const { approved_by } = req.body;
    
    const requestId = validatePositiveInteger(req.params.id, '申请ID');
    const approvedBy = validateRequiredString(approved_by, '审批人姓名');
    
    await withTransaction(async () => {
      const request = await getOne('SELECT * FROM deactivation_requests WHERE id = ?', [requestId]);
      if (!request) {
        throw new Error('申请不存在');
      }
      
      if (request.approved === 1) {
        throw new Error('该申请已审批');
      }
      
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [request.drum_id]);
      if (!drum) {
        throw new Error('关联的鼓具不存在');
      }
      
      if (drum.current_status === '已领出') {
        throw new Error('该鼓具正在使用中，无法批准停用');
      }
      
      if (drum.current_status === '维护中') {
        throw new Error('该鼓具正在维护中，无法批准停用');
      }
      
      const activeUsage = await getOne(`
        SELECT * FROM usage_records 
        WHERE drum_id = ? AND return_time IS NULL
      `, [request.drum_id]);
      
      if (activeUsage) {
        throw new Error('该鼓具有未归还的使用记录，无法批准停用');
      }
      
      const approvalTime = getCurrentTimeISO();
      
      await runQuery(
        `UPDATE deactivation_requests 
         SET approved = 1, approved_by = ?, approved_at = ? 
         WHERE id = ?`,
        [approvedBy, approvalTime, requestId]
      );
      
      await runQuery(
        `UPDATE drums SET current_status = '停用中', updated_at = ? WHERE id = ?`,
        [approvalTime, request.drum_id]
      );
    });
    
    res.json({ message: '停用申请已批准，鼓具已停用' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/reactivate', async (req, res) => {
  try {
    const { drum_id, staff_name } = req.body;
    
    const drumId = validatePositiveInteger(drum_id, '鼓具ID');
    const staffName = validateRequiredString(staff_name, '操作人姓名');
    
    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
      if (!drum) {
        throw new Error('鼓具不存在');
      }
      
      if (drum.current_status !== '停用中') {
        throw new Error(`当前状态为"${drum.current_status}"，不可恢复`);
      }
      
      const reactivateTime = getCurrentTimeISO();
      
      await runQuery(
        `UPDATE drums SET current_status = '恢复可用', updated_at = ? WHERE id = ?`,
        [reactivateTime, drumId]
      );
      
      await runQuery(
        `INSERT INTO inspection_records 
         (drum_id, staff_name, tension, wear_level, notes, created_at)
         VALUES (?, ?, ?, ?, '停用恢复，建议进行全面检查', ?)`,
        [drumId, staffName, drum.tension, drum.wear_level, reactivateTime]
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
      `, [drumId]);
      
      return updatedDrum;
    });
    
    res.json({ message: '鼓具已恢复可用，建议进行全面检查', drum: result });
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

    const drumId = validatePositiveInteger(drum_id, '鼓具ID');
    const staffName = validateRequiredString(staff_name, '申请人姓名');
    const extensionHours = validatePositiveInteger(extension_hours, '延期时长');
    const reasonText = validateRequiredString(reason, '延期原因', 500);

    if (extensionHours <= 0 || extensionHours > 168) {
      return res.status(400).json({ error: '延期时长必须在 1-168 小时之间' });
    }

    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
      if (!drum) {
        throw new Error('鼓具不存在');
      }

      if (drum.current_status !== '已领出') {
        throw new Error(`当前状态为"${drum.current_status}"，不可申请延期`);
      }

      const usageRecord = await getOne(`
        SELECT * FROM usage_records
        WHERE drum_id = ? AND return_time IS NULL
        ORDER BY checkout_time DESC LIMIT 1
      `, [drumId]);

      if (!usageRecord) {
        throw new Error('未找到对应的领出记录');
      }

      if (usageRecord.staff_name !== staffName) {
        const error = new Error('只有领用人本人才能申请延期');
        error.details = {
          borrower: usageRecord.staff_name,
          applicant: staffName
        };
        throw error;
      }

      const pendingExtension = await getOne(`
        SELECT * FROM extension_requests
        WHERE usage_record_id = ? AND approval_status = 'pending'
      `, [usageRecord.id]);

      if (pendingExtension) {
        throw new Error('该借用已有待审批的延期申请，请等待审批');
      }

      const lastApprovedExtension = await getOne(`
        SELECT * FROM extension_requests
        WHERE usage_record_id = ? AND approval_status = 'approved'
        ORDER BY created_at DESC LIMIT 1
      `, [usageRecord.id]);

      const originalExpectedReturn = usageRecord.expected_return_time;
      const currentExpectedReturn = lastApprovedExtension 
        ? lastApprovedExtension.new_expected_return_time 
        : originalExpectedReturn;

      const newExpectedReturn = new Date(new Date(currentExpectedReturn).getTime() + extensionHours * 60 * 60 * 1000).toISOString();

      const extResult = await runQuery(
        `INSERT INTO extension_requests
         (usage_record_id, drum_id, staff_name, extension_hours, reason, original_expected_return_time, new_expected_return_time)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [usageRecord.id, drumId, staffName, extensionHours, reasonText, currentExpectedReturn, newExpectedReturn]
      );

      const extensionRecord = await getOne(`
        SELECT e.*, d.drum_number, d.name as drum_name, u.expected_return_time as original_expected_return_time
        FROM extension_requests e
        JOIN drums d ON e.drum_id = d.id
        JOIN usage_records u ON e.usage_record_id = u.id
        WHERE e.id = ?
      `, [extResult.id]);

      return {
        request_id: extResult.id,
        extension: extensionRecord
      };
    });

    res.json({
      message: '延期申请已提交，等待审批',
      ...result
    });
  } catch (err) {
    if (err.details) {
      res.status(403).json({ error: err.message, details: err.details });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});

router.get('/extension-records', async (req, res) => {
  try {
    const { drum_id, staff_name, approval_status } = req.query;

    let sql = `
      SELECT e.*, d.drum_number, d.name as drum_name, 
             u.expected_return_time as original_expected_return_time,
             sh.name as shift_name, u.staff_name as borrower,
             CASE e.approval_status
               WHEN 'pending' THEN '待审批'
               WHEN 'approved' THEN '已同意'
               WHEN 'rejected' THEN '已拒绝'
               ELSE e.approval_status
             END as approval_status_label,
             CASE 
               WHEN e.approval_status = 'approved' AND e.new_expected_return_time IS NOT NULL 
               THEN e.new_expected_return_time
               ELSE u.expected_return_time
             END as current_expected_return_time
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
