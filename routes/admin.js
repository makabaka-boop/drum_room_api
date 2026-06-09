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

router.post('/shifts', async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const shiftName = validateRequiredString(name, '班次名称', 100);
    
    const result = await runQuery(
      'INSERT INTO shifts (name, description) VALUES (?, ?)',
      [shiftName, description || null]
    );
    res.json({ id: result.id, name: shiftName, description: description || null });
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
    
    const shiftId = validatePositiveInteger(req.params.id, '班次ID');
    const shiftName = validateRequiredString(name, '班次名称', 100);
    
    await runQuery(
      'UPDATE shifts SET name = ?, description = ? WHERE id = ?',
      [shiftName, description || null, shiftId]
    );
    const shift = await getOne('SELECT * FROM shifts WHERE id = ?', [shiftId]);
    if (!shift) {
      return res.status(404).json({ error: '班次不存在' });
    }
    res.json(shift);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/shifts/:id', async (req, res) => {
  try {
    const shiftId = validatePositiveInteger(req.params.id, '班次ID');
    
    const drumCount = await getOne('SELECT COUNT(*) as count FROM drums WHERE shift_id = ?', [shiftId]);
    if (drumCount.count > 0) {
      return res.status(400).json({ 
        error: '该班次下仍有鼓具关联，无法删除',
        details: { drum_count: drumCount.count }
      });
    }
    
    const usageCount = await getOne('SELECT COUNT(*) as count FROM usage_records WHERE shift_id = ?', [shiftId]);
    if (usageCount.count > 0) {
      return res.status(400).json({ 
        error: '该班次下仍有使用记录，无法删除',
        details: { usage_record_count: usageCount.count }
      });
    }
    
    const inspectionCount = await getOne('SELECT COUNT(*) as count FROM inspection_records WHERE shift_id = ?', [shiftId]);
    if (inspectionCount.count > 0) {
      return res.status(400).json({ 
        error: '该班次下仍有巡检记录，无法删除',
        details: { inspection_record_count: inspectionCount.count }
      });
    }
    
    await runQuery('DELETE FROM shifts WHERE id = ?', [shiftId]);
    res.json({ message: '班次已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/positions', async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const positionName = validateRequiredString(name, '架位名称', 100);
    
    const result = await runQuery(
      'INSERT INTO rack_positions (name, description) VALUES (?, ?)',
      [positionName, description || null]
    );
    res.json({ id: result.id, name: positionName, description: description || null });
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
    
    const positionId = validatePositiveInteger(req.params.id, '架位ID');
    const positionName = validateRequiredString(name, '架位名称', 100);
    
    await runQuery(
      'UPDATE rack_positions SET name = ?, description = ? WHERE id = ?',
      [positionName, description || null, positionId]
    );
    const position = await getOne('SELECT * FROM rack_positions WHERE id = ?', [positionId]);
    if (!position) {
      return res.status(404).json({ error: '架位不存在' });
    }
    res.json(position);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/positions/:id', async (req, res) => {
  try {
    const positionId = validatePositiveInteger(req.params.id, '架位ID');
    
    const drumCount = await getOne('SELECT COUNT(*) as count FROM drums WHERE position_id = ?', [positionId]);
    if (drumCount.count > 0) {
      return res.status(400).json({ 
        error: '该架位下仍有鼓具关联，无法删除',
        details: { drum_count: drumCount.count }
      });
    }
    
    await runQuery('DELETE FROM rack_positions WHERE id = ?', [positionId]);
    res.json({ message: '架位已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/skins', async (req, res) => {
  try {
    const { batch_number, type, brand, purchase_date } = req.body;
    
    const batchNumber = validateRequiredString(batch_number, '批次号', 100);
    
    const result = await runQuery(
      'INSERT INTO drum_skins (batch_number, type, brand, purchase_date) VALUES (?, ?, ?, ?)',
      [batchNumber, type || null, brand || null, purchase_date || null]
    );
    res.json({ id: result.id, batch_number: batchNumber, type: type || null, brand: brand || null, purchase_date: purchase_date || null });
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
    
    const skinId = validatePositiveInteger(req.params.id, '鼓皮ID');
    const batchNumber = validateRequiredString(batch_number, '批次号', 100);
    
    await runQuery(
      'UPDATE drum_skins SET batch_number = ?, type = ?, brand = ?, purchase_date = ? WHERE id = ?',
      [batchNumber, type || null, brand || null, purchase_date || null, skinId]
    );
    const skin = await getOne('SELECT * FROM drum_skins WHERE id = ?', [skinId]);
    if (!skin) {
      return res.status(404).json({ error: '鼓皮不存在' });
    }
    res.json(skin);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/skins/:id', async (req, res) => {
  try {
    const skinId = validatePositiveInteger(req.params.id, '鼓皮ID');
    
    const drumCount = await getOne('SELECT COUNT(*) as count FROM drums WHERE skin_id = ?', [skinId]);
    if (drumCount.count > 0) {
      return res.status(400).json({ 
        error: '该鼓皮仍有鼓具使用，无法删除',
        details: { drum_count: drumCount.count }
      });
    }
    
    const maintenanceCount = await getOne('SELECT COUNT(*) as count FROM maintenance_records WHERE new_skin_id = ?', [skinId]);
    if (maintenanceCount.count > 0) {
      return res.status(400).json({ 
        error: '该鼓皮仍有维修记录关联，无法删除',
        details: { maintenance_record_count: maintenanceCount.count }
      });
    }
    
    await runQuery('DELETE FROM drum_skins WHERE id = ?', [skinId]);
    res.json({ message: '鼓皮已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/drums', async (req, res) => {
  try {
    const { drum_number, name, type, size, skin_id, position_id, shift_id, inspection_interval_days } = req.body;
    
    const drumNumber = validateRequiredString(drum_number, '鼓具编号', 50);
    
    if (inspection_interval_days !== undefined) {
      const days = validatePositiveInteger(inspection_interval_days, '巡检间隔天数');
      if (days <= 0 || days > 365) {
        return res.status(400).json({ error: '巡检间隔天数必须在 1-365 天之间' });
      }
    }
    
    const result = await runQuery(
      `INSERT INTO drums (drum_number, name, type, size, skin_id, position_id, shift_id, current_status, inspection_interval_days, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, '待领出', COALESCE(?, 7), ?, ?)`,
      [drumNumber, name || null, type || null, size || null, skin_id || null, position_id || null, 
       shift_id || null, inspection_interval_days, getCurrentTimeISO(), getCurrentTimeISO()]
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
    const drumId = validatePositiveInteger(req.params.id, '鼓具ID');
    
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
    `, [drumId]);
    
    if (!drum) {
      return res.status(404).json({ error: '鼓具不存在' });
    }
    res.json(drum);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/drums/:id', async (req, res) => {
  try {
    const { drum_number, name, type, size, skin_id, position_id, shift_id, current_status, tension, wear_level, inspection_interval_days } = req.body;
    
    const drumId = validatePositiveInteger(req.params.id, '鼓具ID');
    
    if (current_status && !isValidStatus(current_status)) {
      return res.status(400).json({ 
        error: '无效的鼓具状态',
        valid_statuses: VALID_STATUSES
      });
    }
    
    if (wear_level !== undefined) {
      validateWearLevel(wear_level, '磨损等级');
    }
    
    if (inspection_interval_days !== undefined) {
      const days = validatePositiveInteger(inspection_interval_days, '巡检间隔天数');
      if (days <= 0 || days > 365) {
        return res.status(400).json({ error: '巡检间隔天数必须在 1-365 天之间' });
      }
    }
    
    await withTransaction(async () => {
      const existingDrum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
      if (!existingDrum) {
        throw new Error('鼓具不存在');
      }
      
      const newDrumNumber = drum_number || existingDrum.drum_number;
      const newName = name !== undefined ? name : existingDrum.name;
      const newType = type !== undefined ? type : existingDrum.type;
      const newSize = size !== undefined ? size : existingDrum.size;
      const newSkinId = skin_id !== undefined ? skin_id : existingDrum.skin_id;
      const newPositionId = position_id !== undefined ? position_id : existingDrum.position_id;
      const newShiftId = shift_id !== undefined ? shift_id : existingDrum.shift_id;
      const newStatus = current_status || existingDrum.current_status;
      const newTension = tension !== undefined ? tension : existingDrum.tension;
      const newWearLevel = wear_level !== undefined ? wear_level : existingDrum.wear_level;
      const newIntervalDays = inspection_interval_days !== undefined ? inspection_interval_days : existingDrum.inspection_interval_days;
      
      await runQuery(
        `UPDATE drums 
         SET drum_number = ?, name = ?, type = ?, size = ?, skin_id = ?, position_id = ?, 
             shift_id = ?, current_status = ?, tension = ?, wear_level = ?, 
             inspection_interval_days = ?,
             updated_at = ?
         WHERE id = ?`,
        [newDrumNumber, newName, newType, newSize, newSkinId, newPositionId, 
         newShiftId, newStatus, newTension, newWearLevel, newIntervalDays, 
         getCurrentTimeISO(), drumId]
      );
    });
    
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
    `, [drumId]);
    
    res.json(drum);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/drums/:id', async (req, res) => {
  try {
    const drumId = validatePositiveInteger(req.params.id, '鼓具ID');
    
    const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
    if (!drum) {
      return res.status(404).json({ error: '鼓具不存在' });
    }
    
    if (drum.current_status === '已领出') {
      return res.status(400).json({ error: '该鼓具正在使用中，无法删除' });
    }
    
    if (drum.current_status === '维护中') {
      return res.status(400).json({ error: '该鼓具正在维护中，无法删除' });
    }
    
    const usageCount = await getOne('SELECT COUNT(*) as count FROM usage_records WHERE drum_id = ?', [drumId]);
    if (usageCount.count > 0) {
      return res.status(400).json({ 
        error: '该鼓具有使用记录，无法删除',
        details: { usage_record_count: usageCount.count }
      });
    }
    
    const inspectionCount = await getOne('SELECT COUNT(*) as count FROM inspection_records WHERE drum_id = ?', [drumId]);
    if (inspectionCount.count > 0) {
      return res.status(400).json({ 
        error: '该鼓具有巡检记录，无法删除',
        details: { inspection_record_count: inspectionCount.count }
      });
    }
    
    const maintenanceCount = await getOne('SELECT COUNT(*) as count FROM maintenance_records WHERE drum_id = ?', [drumId]);
    if (maintenanceCount.count > 0) {
      return res.status(400).json({ 
        error: '该鼓具有维修记录，无法删除',
        details: { maintenance_record_count: maintenanceCount.count }
      });
    }
    
    const deactivationCount = await getOne('SELECT COUNT(*) as count FROM deactivation_requests WHERE drum_id = ?', [drumId]);
    if (deactivationCount.count > 0) {
      return res.status(400).json({ 
        error: '该鼓具有停用申请记录，无法删除',
        details: { deactivation_request_count: deactivationCount.count }
      });
    }
    
    const extensionCount = await getOne('SELECT COUNT(*) as count FROM extension_requests WHERE drum_id = ?', [drumId]);
    if (extensionCount.count > 0) {
      return res.status(400).json({ 
        error: '该鼓具有延期申请记录，无法删除',
        details: { extension_request_count: extensionCount.count }
      });
    }
    
    await runQuery('DELETE FROM drums WHERE id = ?', [drumId]);
    res.json({ message: '鼓具已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    
    const recordId = validatePositiveInteger(req.params.id, '维修记录ID');
    
    const result = await withTransaction(async () => {
      const recordBefore = await getOne('SELECT * FROM maintenance_records WHERE id = ?', [recordId]);
      if (!recordBefore) {
        throw new Error('维修记录不存在');
      }
      
      if (recordBefore.end_time !== null) {
        throw new Error('该维修记录已完成，不可重复操作');
      }
      
      const shouldMarkReinspected = reinspected === true || recordBefore.need_reinspection === 0;
      const completeTime = getCurrentTimeISO();
      
      await runQuery(
        `UPDATE maintenance_records 
         SET end_time = ?, 
             notes = COALESCE(?, notes),
             reinspected = ?,
             reinspection_date = CASE WHEN ? = 1 THEN ? ELSE reinspection_date END
         WHERE id = ?`,
        [completeTime, notes || null, shouldMarkReinspected ? 1 : 0, 
         shouldMarkReinspected ? 1 : 0, completeTime, recordId]
      );
      
      const record = await getOne('SELECT * FROM maintenance_records WHERE id = ?', [recordId]);
      
      const activeMaintenanceCount = await getOne(`
        SELECT COUNT(*) as count 
        FROM maintenance_records 
        WHERE drum_id = ? AND end_time IS NULL
      `, [record.drum_id]);
      
      let newStatus;
      if (activeMaintenanceCount.count > 0) {
        newStatus = '维护中';
      } else if (record.need_reinspection === 1 && record.reinspected === 0) {
        newStatus = '待巡检';
      } else {
        newStatus = '待领出';
      }
      
      if (activeMaintenanceCount.count === 0 || newStatus !== '维护中') {
        await runQuery('UPDATE drums SET current_status = ?, updated_at = ? WHERE id = ?', 
          [newStatus, completeTime, record.drum_id]);
      }
      
      return {
        record,
        auto_reinspected: shouldMarkReinspected && recordBefore.need_reinspection === 0,
        new_status: newStatus,
        has_other_active_maintenance: activeMaintenanceCount.count > 0
      };
    });
    
    res.json({ 
      message: '维修已完成', 
      ...result
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/extension/:id/approve', async (req, res) => {
  try {
    const { approved_by, approval_notes } = req.body;

    const requestId = validatePositiveInteger(req.params.id, '延期申请ID');
    const approvedBy = validateRequiredString(approved_by, '审批人姓名');

    const result = await withTransaction(async () => {
      const request = await getOne('SELECT * FROM extension_requests WHERE id = ?', [requestId]);
      if (!request) {
        throw new Error('延期申请不存在');
      }

      if (request.approval_status !== 'pending') {
        const statusText = request.approval_status === 'approved' ? '批准' : '拒绝';
        throw new Error(`该申请已被${statusText}，不可重复审批`);
      }

      const usageRecord = await getOne('SELECT * FROM usage_records WHERE id = ?', [request.usage_record_id]);
      if (!usageRecord) {
        throw new Error('关联的使用记录不存在');
      }

      if (usageRecord.return_time !== null) {
        throw new Error('该鼓具已归还，无法审批延期');
      }

      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [request.drum_id]);
      if (!drum || drum.current_status !== '已领出') {
        throw new Error('鼓具状态异常，无法审批延期');
      }

      const lastApprovedExtension = await getOne(`
        SELECT * FROM extension_requests
        WHERE usage_record_id = ? AND approval_status = 'approved' AND id != ?
        ORDER BY created_at DESC LIMIT 1
      `, [usageRecord.id, requestId]);

      const currentExpectedReturn = lastApprovedExtension 
        ? lastApprovedExtension.new_expected_return_time 
        : usageRecord.expected_return_time;

      if (request.original_expected_return_time !== currentExpectedReturn) {
        throw new Error('当前预计归还时间已变更，请重新申请延期');
      }

      const approvalTime = getCurrentTimeISO();

      await runQuery(
        `UPDATE extension_requests 
         SET approval_status = 'approved', 
             approved_by = ?, 
             approved_at = ?,
             approval_notes = ?,
             new_expected_return_time = ?
         WHERE id = ?`,
        [approvedBy, approvalTime, approval_notes || null, request.new_expected_return_time, requestId]
      );

      await runQuery(
        `UPDATE usage_records 
         SET expected_return_time = ?
         WHERE id = ?`,
        [request.new_expected_return_time, request.usage_record_id]
      );

      const updatedRequest = await getOne(`
        SELECT e.*, d.drum_number, d.name as drum_name, u.expected_return_time as original_expected_return_time
        FROM extension_requests e
        JOIN drums d ON e.drum_id = d.id
        JOIN usage_records u ON e.usage_record_id = u.id
        WHERE e.id = ?
      `, [requestId]);

      return updatedRequest;
    });

    res.json({
      message: '延期申请已批准，预计归还时间已更新',
      extension: result
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/extension/:id/reject', async (req, res) => {
  try {
    const { approved_by, approval_notes } = req.body;

    const requestId = validatePositiveInteger(req.params.id, '延期申请ID');
    const approvedBy = validateRequiredString(approved_by, '审批人姓名');

    const result = await withTransaction(async () => {
      const request = await getOne('SELECT * FROM extension_requests WHERE id = ?', [requestId]);
      if (!request) {
        throw new Error('延期申请不存在');
      }

      if (request.approval_status !== 'pending') {
        const statusText = request.approval_status === 'approved' ? '批准' : '拒绝';
        throw new Error(`该申请已被${statusText}，不可重复审批`);
      }

      const usageRecord = await getOne('SELECT * FROM usage_records WHERE id = ?', [request.usage_record_id]);
      if (!usageRecord) {
        throw new Error('关联的使用记录不存在');
      }

      const approvalTime = getCurrentTimeISO();

      await runQuery(
        `UPDATE extension_requests 
         SET approval_status = 'rejected', 
             approved_by = ?, 
             approved_at = ?,
             approval_notes = ?,
             new_expected_return_time = NULL
         WHERE id = ?`,
        [approvedBy, approvalTime, approval_notes || null, requestId]
      );

      const updatedRequest = await getOne(`
        SELECT e.*, d.drum_number, d.name as drum_name, u.expected_return_time as original_expected_return_time
        FROM extension_requests e
        JOIN drums d ON e.drum_id = d.id
        JOIN usage_records u ON e.usage_record_id = u.id
        WHERE e.id = ?
      `, [requestId]);

      return updatedRequest;
    });

    res.json({
      message: '延期申请已拒绝',
      extension: result
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/extension-requests', async (req, res) => {
  try {
    const { drum_id, staff_name, approval_status } = req.query;

    let sql = `
      SELECT e.*, d.drum_number, d.name as drum_name, 
             u.expected_return_time as original_expected_return_time,
             u.staff_name as borrower, u.purpose,
             CASE 
               WHEN e.approval_status = 'approved' AND e.new_expected_return_time IS NOT NULL 
               THEN e.new_expected_return_time
               ELSE u.expected_return_time
             END as current_expected_return_time
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
