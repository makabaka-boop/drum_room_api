const express = require('express');
const router = express.Router();
const { runQuery, getQuery, getOne, nowISO, withTransaction } = require('../database');

const VALID_STATUSES = ['待领出', '已领出', '待巡检', '维护中', '停用中', '恢复可用'];

const parseId = (val) => {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
};

const parseInteger = (val) => {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
};

const isNonEmptyString = (val) => typeof val === 'string' && val.trim().length > 0;

const isValidWearLevel = (val) => {
  if (val === undefined || val === null) return true;
  const n = Number(val);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 10;
};

router.post('/shifts', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: '参数错误: name 不可为空' });
    }
    const result = await runQuery(
      'INSERT INTO shifts (name, description) VALUES (?, ?)',
      [name.trim(), description || null]
    );
    res.json({ id: result.id, name: name.trim(), description: description || null });
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
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: '参数错误: id 必须为正整数' });
    const { name, description } = req.body;
    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: '参数错误: name 不可为空' });
    }
    const exists = await getOne('SELECT id FROM shifts WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ error: 'Shift not found' });

    await runQuery(
      'UPDATE shifts SET name = ?, description = ? WHERE id = ?',
      [name.trim(), description || null, id]
    );
    const shift = await getOne('SELECT * FROM shifts WHERE id = ?', [id]);
    res.json(shift);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/shifts/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: '参数错误: id 必须为正整数' });

    const exists = await getOne('SELECT id FROM shifts WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ error: 'Shift not found' });

    const drumRef = await getOne('SELECT COUNT(*) as cnt FROM drums WHERE shift_id = ?', [id]);
    const usageRef = await getOne('SELECT COUNT(*) as cnt FROM usage_records WHERE shift_id = ?', [id]);
    const inspectRef = await getOne('SELECT COUNT(*) as cnt FROM inspection_records WHERE shift_id = ?', [id]);
    if (drumRef.cnt + usageRef.cnt + inspectRef.cnt > 0) {
      return res.status(400).json({
        error: '该班次已被引用，无法删除',
        details: {
          drums: drumRef.cnt,
          usage_records: usageRef.cnt,
          inspection_records: inspectRef.cnt
        }
      });
    }

    await runQuery('DELETE FROM shifts WHERE id = ?', [id]);
    res.json({ message: 'Shift deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/positions', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: '参数错误: name 不可为空' });
    }
    const result = await runQuery(
      'INSERT INTO rack_positions (name, description) VALUES (?, ?)',
      [name.trim(), description || null]
    );
    res.json({ id: result.id, name: name.trim(), description: description || null });
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
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: '参数错误: id 必须为正整数' });
    const { name, description } = req.body;
    if (!isNonEmptyString(name)) {
      return res.status(400).json({ error: '参数错误: name 不可为空' });
    }
    const exists = await getOne('SELECT id FROM rack_positions WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ error: 'Position not found' });

    await runQuery(
      'UPDATE rack_positions SET name = ?, description = ? WHERE id = ?',
      [name.trim(), description || null, id]
    );
    const position = await getOne('SELECT * FROM rack_positions WHERE id = ?', [id]);
    res.json(position);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/positions/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: '参数错误: id 必须为正整数' });

    const exists = await getOne('SELECT id FROM rack_positions WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ error: 'Position not found' });

    const drumRef = await getOne('SELECT COUNT(*) as cnt FROM drums WHERE position_id = ?', [id]);
    if (drumRef.cnt > 0) {
      return res.status(400).json({
        error: '该位置已被鼓具引用，无法删除',
        details: { drums: drumRef.cnt }
      });
    }

    await runQuery('DELETE FROM rack_positions WHERE id = ?', [id]);
    res.json({ message: 'Position deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/skins', async (req, res) => {
  try {
    const { batch_number, type, brand, purchase_date } = req.body;
    if (!isNonEmptyString(batch_number)) {
      return res.status(400).json({ error: '参数错误: batch_number 不可为空' });
    }
    const result = await runQuery(
      'INSERT INTO drum_skins (batch_number, type, brand, purchase_date) VALUES (?, ?, ?, ?)',
      [batch_number.trim(), type || null, brand || null, purchase_date || null]
    );
    res.json({ id: result.id, batch_number: batch_number.trim(), type, brand, purchase_date });
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
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: '参数错误: id 必须为正整数' });
    const { batch_number, type, brand, purchase_date } = req.body;
    if (!isNonEmptyString(batch_number)) {
      return res.status(400).json({ error: '参数错误: batch_number 不可为空' });
    }
    const exists = await getOne('SELECT id FROM drum_skins WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ error: 'Skin not found' });

    await runQuery(
      'UPDATE drum_skins SET batch_number = ?, type = ?, brand = ?, purchase_date = ? WHERE id = ?',
      [batch_number.trim(), type || null, brand || null, purchase_date || null, id]
    );
    const skin = await getOne('SELECT * FROM drum_skins WHERE id = ?', [id]);
    res.json(skin);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/skins/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: '参数错误: id 必须为正整数' });

    const exists = await getOne('SELECT id FROM drum_skins WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ error: 'Skin not found' });

    const drumRef = await getOne('SELECT COUNT(*) as cnt FROM drums WHERE skin_id = ?', [id]);
    const maintRef = await getOne('SELECT COUNT(*) as cnt FROM maintenance_records WHERE new_skin_id = ?', [id]);
    if (drumRef.cnt + maintRef.cnt > 0) {
      return res.status(400).json({
        error: '该鼓皮批次已被引用，无法删除',
        details: { drums: drumRef.cnt, maintenance_records: maintRef.cnt }
      });
    }

    await runQuery('DELETE FROM drum_skins WHERE id = ?', [id]);
    res.json({ message: 'Drum skin deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/drums', async (req, res) => {
  try {
    const { drum_number, name, type, size, skin_id, position_id, shift_id, inspection_interval_days } = req.body;
    if (!isNonEmptyString(drum_number)) {
      return res.status(400).json({ error: '参数错误: drum_number 不可为空' });
    }
    let intervalDays = null;
    if (inspection_interval_days !== undefined && inspection_interval_days !== null && inspection_interval_days !== '') {
      intervalDays = parseInteger(inspection_interval_days);
      if (intervalDays === null || intervalDays <= 0 || intervalDays > 365) {
        return res.status(400).json({ error: '参数错误: inspection_interval_days 必须是 1 ~ 365 之间的整数' });
      }
    }

    for (const [field, val] of [['skin_id', skin_id], ['position_id', position_id], ['shift_id', shift_id]]) {
      if (val !== undefined && val !== null && val !== '' && parseId(val) === null) {
        return res.status(400).json({ error: `参数错误: ${field} 必须为正整数` });
      }
    }

    const result = await runQuery(
      `INSERT INTO drums (drum_number, name, type, size, skin_id, position_id, shift_id, current_status, inspection_interval_days) 
       VALUES (?, ?, ?, ?, ?, ?, ?, '待领出', COALESCE(?, 7))`,
      [drum_number.trim(), name || null, type || null, size || null,
       skin_id || null, position_id || null, shift_id || null, intervalDays]
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
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: '参数错误: id 必须为正整数' });
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
    `, [id]);
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
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: '参数错误: id 必须为正整数' });
    const { drum_number, name, type, size, skin_id, position_id, shift_id, current_status, tension, wear_level, inspection_interval_days } = req.body;

    if (!isNonEmptyString(drum_number)) {
      return res.status(400).json({ error: '参数错误: drum_number 不可为空' });
    }
    if (current_status !== undefined && current_status !== null && current_status !== '' && !VALID_STATUSES.includes(current_status)) {
      return res.status(400).json({ error: `参数错误: current_status 必须是 ${VALID_STATUSES.join('/')} 之一` });
    }
    if (!isValidWearLevel(wear_level)) {
      return res.status(400).json({ error: '参数错误: wear_level 必须是 0 ~ 10 的整数' });
    }
    let intervalDays = null;
    if (inspection_interval_days !== undefined && inspection_interval_days !== null && inspection_interval_days !== '') {
      intervalDays = parseInteger(inspection_interval_days);
      if (intervalDays === null || intervalDays <= 0 || intervalDays > 365) {
        return res.status(400).json({ error: '参数错误: inspection_interval_days 必须是 1 ~ 365 之间的整数' });
      }
    }

    const drumBefore = await getOne('SELECT * FROM drums WHERE id = ?', [id]);
    if (!drumBefore) return res.status(404).json({ error: 'Drum not found' });

    // 后台修改状态时进行关联校验，避免破坏在借/维修流程
    if (current_status && current_status !== drumBefore.current_status) {
      const activeUsage = await getOne(
        'SELECT id FROM usage_records WHERE drum_id = ? AND return_time IS NULL',
        [id]
      );
      if (activeUsage && current_status !== '已领出') {
        return res.status(400).json({ error: '存在未归还的领出记录，不可修改为该状态，请先归位' });
      }
      if (!activeUsage && current_status === '已领出') {
        return res.status(400).json({ error: '不存在未归还的领出记录，不可强制设为"已领出"' });
      }
      const activeMaintenance = await getOne(
        'SELECT id FROM maintenance_records WHERE drum_id = ? AND end_time IS NULL',
        [id]
      );
      if (activeMaintenance && !['维护中', '已领出'].includes(current_status)) {
        return res.status(400).json({ error: '存在未完成的维修记录，不可修改为该状态' });
      }
    }

    await runQuery(
      `UPDATE drums 
       SET drum_number = ?, name = ?, type = ?, size = ?, skin_id = ?, position_id = ?, 
           shift_id = ?, current_status = ?, tension = ?, wear_level = ?, 
           inspection_interval_days = COALESCE(?, inspection_interval_days),
           updated_at = ?
       WHERE id = ?`,
      [drum_number.trim(), name || null, type || null, size || null,
       skin_id || null, position_id || null, shift_id || null,
       current_status || drumBefore.current_status, tension || null,
       wear_level !== undefined && wear_level !== null && wear_level !== '' ? parseInteger(wear_level) : drumBefore.wear_level,
       intervalDays, nowISO(), id]
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
    `, [id]);
    res.json(drum);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/drums/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: '参数错误: id 必须为正整数' });

    const exists = await getOne('SELECT * FROM drums WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ error: 'Drum not found' });

    if (exists.current_status === '已领出') {
      return res.status(400).json({ error: '该鼓具仍处于领出状态，不可删除' });
    }
    if (exists.current_status === '维护中') {
      return res.status(400).json({ error: '该鼓具维护中，不可删除' });
    }

    const usageRef = await getOne('SELECT COUNT(*) as cnt FROM usage_records WHERE drum_id = ?', [id]);
    const inspectRef = await getOne('SELECT COUNT(*) as cnt FROM inspection_records WHERE drum_id = ?', [id]);
    const maintRef = await getOne('SELECT COUNT(*) as cnt FROM maintenance_records WHERE drum_id = ?', [id]);
    const extRef = await getOne('SELECT COUNT(*) as cnt FROM extension_requests WHERE drum_id = ?', [id]);
    if (usageRef.cnt + inspectRef.cnt + maintRef.cnt + extRef.cnt > 0) {
      return res.status(400).json({
        error: '该鼓具存在历史记录，不可删除（建议改为停用）',
        details: {
          usage_records: usageRef.cnt,
          inspection_records: inspectRef.cnt,
          maintenance_records: maintRef.cnt,
          extension_requests: extRef.cnt
        }
      });
    }

    await runQuery('DELETE FROM drums WHERE id = ?', [id]);
    res.json({ message: 'Drum deleted' });
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
    const mid = parseId(req.params.id);
    if (!mid) return res.status(400).json({ error: '参数错误: id 必须为正整数' });
    const { notes, reinspected } = req.body;

    const result = await withTransaction(async () => {
      const recordBefore = await getOne('SELECT * FROM maintenance_records WHERE id = ?', [mid]);
      if (!recordBefore) {
        const err = new Error('Maintenance record not found');
        err.statusCode = 404;
        throw err;
      }

      // 幂等性：已完成的记录不可重复完成
      if (recordBefore.end_time !== null) {
        const err = new Error('该维修记录已完成，不可重复完成');
        err.statusCode = 400;
        throw err;
      }

      const shouldMarkReinspected = reinspected === true || recordBefore.need_reinspection === 0;
      const nowIso = nowISO();

      await runQuery(
        `UPDATE maintenance_records 
         SET end_time = ?, 
             notes = COALESCE(?, notes),
             reinspected = ?,
             reinspection_date = CASE WHEN ? = 1 THEN ? ELSE reinspection_date END
         WHERE id = ?`,
        [nowIso, notes || null, shouldMarkReinspected ? 1 : 0,
         shouldMarkReinspected ? 1 : 0, nowIso, mid]
      );

      // 检查该鼓具是否仍存在其它未完成或未复检的维修记录
      const otherActive = await getOne(`
        SELECT COUNT(*) as cnt FROM maintenance_records 
        WHERE drum_id = ? AND id != ? AND end_time IS NULL
      `, [recordBefore.drum_id, mid]);

      const otherNeedReinspection = await getOne(`
        SELECT COUNT(*) as cnt FROM maintenance_records 
        WHERE drum_id = ? AND id != ? AND need_reinspection = 1 AND reinspected = 0
      `, [recordBefore.drum_id, mid]);

      const record = await getOne('SELECT * FROM maintenance_records WHERE id = ?', [mid]);

      let newStatus;
      if (otherActive.cnt > 0) {
        newStatus = '维护中';
      } else if (otherNeedReinspection.cnt > 0 || (record.need_reinspection === 1 && record.reinspected === 0)) {
        newStatus = '待巡检';
      } else {
        newStatus = '待领出';
      }

      await runQuery('UPDATE drums SET current_status = ?, updated_at = ? WHERE id = ?',
        [newStatus, nowIso, recordBefore.drum_id]);

      return {
        record,
        newStatus,
        auto_reinspected: shouldMarkReinspected && recordBefore.need_reinspection === 0
      };
    });

    res.json({
      message: 'Maintenance completed',
      record: result.record,
      drum_status: result.newStatus,
      auto_reinspected: result.auto_reinspected
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/extension/:id/approve', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: '参数错误: id 必须为正整数' });
    const { approved_by, approval_notes } = req.body;

    if (!isNonEmptyString(approved_by)) {
      return res.status(400).json({ error: '缺少审批人信息: approved_by' });
    }

    const result = await withTransaction(async () => {
      const request = await getOne('SELECT * FROM extension_requests WHERE id = ?', [id]);
      if (!request) {
        const err = new Error('延期申请不存在');
        err.statusCode = 404;
        throw err;
      }

      if (request.approval_status !== 'pending') {
        const err = new Error(`该申请已被${request.approval_status === 'approved' ? '批准' : '拒绝'}，不可重复审批`);
        err.statusCode = 400;
        throw err;
      }

      const usageRecord = await getOne('SELECT * FROM usage_records WHERE id = ?', [request.usage_record_id]);
      if (!usageRecord) {
        const err = new Error('关联的使用记录不存在');
        err.statusCode = 404;
        throw err;
      }

      if (usageRecord.return_time !== null) {
        const err = new Error('该鼓具已归还，无法审批延期');
        err.statusCode = 400;
        throw err;
      }

      // 基于审批时刻使用记录的当前预计归还时间重新计算，确保多次延期叠加正确
      const baseTime = usageRecord.expected_return_time
        ? new Date(usageRecord.expected_return_time).getTime()
        : new Date(request.original_expected_return_time).getTime();
      const newExpectedReturn = new Date(baseTime + request.extension_hours * 60 * 60 * 1000).toISOString();

      const nowIso = nowISO();
      await runQuery(
        `UPDATE extension_requests 
         SET approval_status = 'approved', 
             approved_by = ?, 
             approved_at = ?,
             approval_notes = ?,
             new_expected_return_time = ?
         WHERE id = ?`,
        [approved_by, nowIso, approval_notes || null, newExpectedReturn, id]
      );

      await runQuery(
        `UPDATE usage_records 
         SET expected_return_time = ?, is_overdue = 0
         WHERE id = ?`,
        [newExpectedReturn, request.usage_record_id]
      );

      return await getOne(`
        SELECT e.*, d.drum_number, d.name as drum_name, u.expected_return_time as current_expected_return_time
        FROM extension_requests e
        JOIN drums d ON e.drum_id = d.id
        JOIN usage_records u ON e.usage_record_id = u.id
        WHERE e.id = ?
      `, [id]);
    });

    res.json({
      message: '延期申请已批准，预计归还时间已更新',
      extension: result
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/extension/:id/reject', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: '参数错误: id 必须为正整数' });
    const { approved_by, approval_notes } = req.body;

    if (!isNonEmptyString(approved_by)) {
      return res.status(400).json({ error: '缺少审批人信息: approved_by' });
    }

    const result = await withTransaction(async () => {
      const request = await getOne('SELECT * FROM extension_requests WHERE id = ?', [id]);
      if (!request) {
        const err = new Error('延期申请不存在');
        err.statusCode = 404;
        throw err;
      }

      if (request.approval_status !== 'pending') {
        const err = new Error(`该申请已被${request.approval_status === 'approved' ? '批准' : '拒绝'}，不可重复审批`);
        err.statusCode = 400;
        throw err;
      }

      const nowIso = nowISO();
      await runQuery(
        `UPDATE extension_requests 
         SET approval_status = 'rejected', 
             approved_by = ?, 
             approved_at = ?,
             approval_notes = ?,
             new_expected_return_time = NULL
         WHERE id = ?`,
        [approved_by, nowIso, approval_notes || null, id]
      );

      return await getOne(`
        SELECT e.*, d.drum_number, d.name as drum_name, u.expected_return_time as current_expected_return_time
        FROM extension_requests e
        JOIN drums d ON e.drum_id = d.id
        JOIN usage_records u ON e.usage_record_id = u.id
        WHERE e.id = ?
      `, [id]);
    });

    res.json({
      message: '延期申请已拒绝',
      extension: result
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
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
      const did = parseId(drum_id);
      if (!did) return res.status(400).json({ error: '参数错误: drum_id 必须为正整数' });
      sql += ` AND e.drum_id = ?`;
      params.push(did);
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
