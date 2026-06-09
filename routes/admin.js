const express = require('express');
const router = express.Router();
const {
  runQuery, getQuery, getOne, withTransaction, nowIso,
  VALID_DRUM_STATUSES, isValidStatus,
  isPosInt, isNonNegInt, isValidWearLevel, isNonEmptyStr, toBool
} = require('../database');

const DRUM_JOIN = `
  SELECT d.*, 
         s.batch_number as skin_batch,
         p.name as position_name,
         sh.name as shift_name
  FROM drums d
  LEFT JOIN drum_skins s ON d.skin_id = s.id
  LEFT JOIN rack_positions p ON d.position_id = p.id
  LEFT JOIN shifts sh ON d.shift_id = sh.id
`;

async function assertExists(table, id) {
  if (id === null || id === undefined) return;
  const row = await getOne(`SELECT id FROM ${table} WHERE id = ?`, [id]);
  if (!row) {
    const e = new Error(`引用的${table}记录(id=${id})不存在`);
    e.statusCode = 400;
    throw e;
  }
}

router.post('/shifts', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!isNonEmptyStr(name)) {
      return res.status(400).json({ error: '参数错误: name 不能为空' });
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
    const id = parseInt(req.params.id, 10);
    if (!isPosInt(id)) return res.status(400).json({ error: '无效的班次ID' });
    const { name, description } = req.body;
    if (!isNonEmptyStr(name)) {
      return res.status(400).json({ error: '参数错误: name 不能为空' });
    }
    await runQuery(
      'UPDATE shifts SET name = ?, description = ? WHERE id = ?',
      [name.trim(), description || null, id]
    );
    const shift = await getOne('SELECT * FROM shifts WHERE id = ?', [id]);
    if (!shift) return res.status(404).json({ error: '班次不存在' });
    res.json(shift);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/shifts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPosInt(id)) return res.status(400).json({ error: '无效的班次ID' });

    await withTransaction(async () => {
      const shift = await getOne('SELECT * FROM shifts WHERE id = ?', [id]);
      if (!shift) { const e = new Error('班次不存在'); e.statusCode = 404; throw e; }

      const drumCount = await getOne('SELECT COUNT(*) as cnt FROM drums WHERE shift_id = ?', [id]);
      if (drumCount.cnt > 0) {
        const e = new Error(`该班次下还有${drumCount.cnt}个鼓具，无法删除`);
        e.statusCode = 400;
        throw e;
      }
      const usageCount = await getOne('SELECT COUNT(*) as cnt FROM usage_records WHERE shift_id = ?', [id]);
      if (usageCount.cnt > 0) {
        const e = new Error(`该班次关联了${usageCount.cnt}条使用记录，无法删除`);
        e.statusCode = 400;
        throw e;
      }
      const inspectCount = await getOne('SELECT COUNT(*) as cnt FROM inspection_records WHERE shift_id = ?', [id]);
      if (inspectCount.cnt > 0) {
        const e = new Error(`该班次关联了${inspectCount.cnt}条巡检记录，无法删除`);
        e.statusCode = 400;
        throw e;
      }
      await runQuery('DELETE FROM shifts WHERE id = ?', [id]);
    });

    res.json({ message: '班次已删除' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/positions', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!isNonEmptyStr(name)) {
      return res.status(400).json({ error: '参数错误: name 不能为空' });
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
    const id = parseInt(req.params.id, 10);
    if (!isPosInt(id)) return res.status(400).json({ error: '无效的位置ID' });
    const { name, description } = req.body;
    if (!isNonEmptyStr(name)) {
      return res.status(400).json({ error: '参数错误: name 不能为空' });
    }
    await runQuery(
      'UPDATE rack_positions SET name = ?, description = ? WHERE id = ?',
      [name.trim(), description || null, id]
    );
    const position = await getOne('SELECT * FROM rack_positions WHERE id = ?', [id]);
    if (!position) return res.status(404).json({ error: '位置不存在' });
    res.json(position);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/positions/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPosInt(id)) return res.status(400).json({ error: '无效的位置ID' });

    await withTransaction(async () => {
      const pos = await getOne('SELECT * FROM rack_positions WHERE id = ?', [id]);
      if (!pos) { const e = new Error('位置不存在'); e.statusCode = 404; throw e; }

      const drumCount = await getOne('SELECT COUNT(*) as cnt FROM drums WHERE position_id = ?', [id]);
      if (drumCount.cnt > 0) {
        const e = new Error(`该位置下还有${drumCount.cnt}个鼓具，无法删除`);
        e.statusCode = 400;
        throw e;
      }
      await runQuery('DELETE FROM rack_positions WHERE id = ?', [id]);
    });

    res.json({ message: '位置已删除' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/skins', async (req, res) => {
  try {
    const { batch_number, type, brand, purchase_date } = req.body;
    if (!isNonEmptyStr(batch_number)) {
      return res.status(400).json({ error: '参数错误: batch_number 不能为空' });
    }
    const result = await runQuery(
      'INSERT INTO drum_skins (batch_number, type, brand, purchase_date) VALUES (?, ?, ?, ?)',
      [batch_number.trim(), type || null, brand || null, purchase_date || null]
    );
    res.json({ id: result.id, batch_number: batch_number.trim(), type: type || null, brand: brand || null, purchase_date: purchase_date || null });
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
    const id = parseInt(req.params.id, 10);
    if (!isPosInt(id)) return res.status(400).json({ error: '无效的鼓皮ID' });
    const { batch_number, type, brand, purchase_date } = req.body;
    if (!isNonEmptyStr(batch_number)) {
      return res.status(400).json({ error: '参数错误: batch_number 不能为空' });
    }
    await runQuery(
      'UPDATE drum_skins SET batch_number = ?, type = ?, brand = ?, purchase_date = ? WHERE id = ?',
      [batch_number.trim(), type || null, brand || null, purchase_date || null, id]
    );
    const skin = await getOne('SELECT * FROM drum_skins WHERE id = ?', [id]);
    if (!skin) return res.status(404).json({ error: '鼓皮不存在' });
    res.json(skin);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/skins/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPosInt(id)) return res.status(400).json({ error: '无效的鼓皮ID' });

    await withTransaction(async () => {
      const skin = await getOne('SELECT * FROM drum_skins WHERE id = ?', [id]);
      if (!skin) { const e = new Error('鼓皮不存在'); e.statusCode = 404; throw e; }

      const drumCount = await getOne('SELECT COUNT(*) as cnt FROM drums WHERE skin_id = ?', [id]);
      if (drumCount.cnt > 0) {
        const e = new Error(`有${drumCount.cnt}个鼓具正在使用该鼓皮，无法删除`);
        e.statusCode = 400;
        throw e;
      }
      const maintCount = await getOne('SELECT COUNT(*) as cnt FROM maintenance_records WHERE new_skin_id = ?', [id]);
      if (maintCount.cnt > 0) {
        const e = new Error(`有${maintCount.cnt}条维修记录引用该鼓皮，无法删除`);
        e.statusCode = 400;
        throw e;
      }
      await runQuery('DELETE FROM drum_skins WHERE id = ?', [id]);
    });

    res.json({ message: '鼓皮已删除' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/drums', async (req, res) => {
  try {
    const { drum_number, name, type, size, skin_id, position_id, shift_id, inspection_interval_days } = req.body;

    if (!isNonEmptyStr(drum_number)) {
      return res.status(400).json({ error: '参数错误: drum_number 不能为空' });
    }
    if (skin_id !== undefined && skin_id !== null && !isPosInt(skin_id)) {
      return res.status(400).json({ error: '参数错误: skin_id 必须为正整数或空' });
    }
    if (position_id !== undefined && position_id !== null && !isPosInt(position_id)) {
      return res.status(400).json({ error: '参数错误: position_id 必须为正整数或空' });
    }
    if (shift_id !== undefined && shift_id !== null && !isPosInt(shift_id)) {
      return res.status(400).json({ error: '参数错误: shift_id 必须为正整数或空' });
    }

    let intervalDays = 7;
    if (inspection_interval_days !== undefined && inspection_interval_days !== null) {
      intervalDays = Number(inspection_interval_days);
      if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) {
        return res.status(400).json({ error: '参数错误: inspection_interval_days 必须为1-365之间的整数' });
      }
    }

    await withTransaction(async () => {
      await assertExists('drum_skins', skin_id || null);
      await assertExists('rack_positions', position_id || null);
      await assertExists('shifts', shift_id || null);

      const now = nowIso();
      const result = await runQuery(
        `INSERT INTO drums (drum_number, name, type, size, skin_id, position_id, shift_id, current_status, inspection_interval_days, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, '待领出', ?, ?, ?)`,
        [drum_number.trim(), name || null, type || null, size || null, skin_id || null, position_id || null, shift_id || null, intervalDays, now, now]
      );
      return await getOne(`${DRUM_JOIN} WHERE d.id = ?`, [result.id]);
    }).then(drum => res.json(drum));
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
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
    const id = parseInt(req.params.id, 10);
    if (!isPosInt(id)) return res.status(400).json({ error: '无效的鼓具ID' });
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
    if (!drum) return res.status(404).json({ error: '鼓具不存在' });
    res.json(drum);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/drums/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPosInt(id)) return res.status(400).json({ error: '无效的鼓具ID' });

    const { drum_number, name, type, size, skin_id, position_id, shift_id, current_status, tension, wear_level, inspection_interval_days } = req.body;

    if (drum_number !== undefined && !isNonEmptyStr(drum_number)) {
      return res.status(400).json({ error: '参数错误: drum_number 不能为空' });
    }
    if (skin_id !== undefined && skin_id !== null && !isPosInt(skin_id)) {
      return res.status(400).json({ error: '参数错误: skin_id 必须为正整数或空' });
    }
    if (position_id !== undefined && position_id !== null && !isPosInt(position_id)) {
      return res.status(400).json({ error: '参数错误: position_id 必须为正整数或空' });
    }
    if (shift_id !== undefined && shift_id !== null && !isPosInt(shift_id)) {
      return res.status(400).json({ error: '参数错误: shift_id 必须为正整数或空' });
    }
    if (current_status !== undefined && current_status !== null && !isValidStatus(current_status)) {
      return res.status(400).json({ error: `参数错误: current_status 必须是以下之一: ${VALID_DRUM_STATUSES.join(', ')}` });
    }
    if (wear_level !== undefined && wear_level !== null) {
      const wl = Number(wear_level);
      if (!isValidWearLevel(wl)) {
        return res.status(400).json({ error: '参数错误: wear_level 必须为0-10之间的整数' });
      }
    }
    if (inspection_interval_days !== undefined && inspection_interval_days !== null) {
      const iv = Number(inspection_interval_days);
      if (!Number.isInteger(iv) || iv < 1 || iv > 365) {
        return res.status(400).json({ error: '参数错误: inspection_interval_days 必须为1-365之间的整数' });
      }
    }

    await withTransaction(async () => {
      const existing = await getOne('SELECT * FROM drums WHERE id = ?', [id]);
      if (!existing) { const e = new Error('鼓具不存在'); e.statusCode = 404; throw e; }

      if (skin_id !== undefined) await assertExists('drum_skins', skin_id || null);
      if (position_id !== undefined) await assertExists('rack_positions', position_id || null);
      if (shift_id !== undefined) await assertExists('shifts', shift_id || null);

      const newDrumNumber = drum_number !== undefined ? drum_number.trim() : existing.drum_number;
      const newName = name !== undefined ? (name || null) : existing.name;
      const newType = type !== undefined ? (type || null) : existing.type;
      const newSize = size !== undefined ? (size || null) : existing.size;
      const newSkinId = skin_id !== undefined ? (skin_id || null) : existing.skin_id;
      const newPosId = position_id !== undefined ? (position_id || null) : existing.position_id;
      const newShiftId = shift_id !== undefined ? (shift_id || null) : existing.shift_id;
      const newStatus = current_status !== undefined ? (current_status || null) : existing.current_status;
      const newTension = tension !== undefined ? (tension || null) : existing.tension;
      const newWear = wear_level !== undefined ? (wear_level !== null ? Number(wear_level) : existing.wear_level) : existing.wear_level;
      const newInterval = inspection_interval_days !== undefined
        ? (inspection_interval_days !== null ? Number(inspection_interval_days) : existing.inspection_interval_days)
        : existing.inspection_interval_days;

      if (newStatus && !isValidStatus(newStatus)) {
        const e = new Error(`无效的鼓具状态: ${newStatus}`);
        e.statusCode = 400;
        throw e;
      }

      if (newStatus === '已领出' && existing.current_status !== '已领出') {
        const activeUsage = await getOne(
          'SELECT id FROM usage_records WHERE drum_id = ? AND return_time IS NULL',
          [id]
        );
        if (!activeUsage) {
          const e = new Error('不能直接将状态改为已领出，请通过借出接口操作');
          e.statusCode = 400;
          throw e;
        }
      }
      if (newStatus === '停用中' && existing.current_status !== '停用中') {
        const e = new Error('不能直接将状态改为停用中，请通过停用审批流程操作');
        e.statusCode = 400;
        throw e;
      }
      if (newStatus === '停用申请中' && existing.current_status !== '停用申请中') {
        const e = new Error('不能直接将状态改为停用申请中，请通过员工停用申请操作');
        e.statusCode = 400;
        throw e;
      }
      if (newStatus === '维护中' && existing.current_status !== '维护中') {
        const openMaint = await getOne(
          'SELECT id FROM maintenance_records WHERE drum_id = ? AND end_time IS NULL',
          [id]
        );
        if (!openMaint) {
          const e = new Error('不能直接将状态改为维护中，请通过维修接口操作');
          e.statusCode = 400;
          throw e;
        }
      }

      const now = nowIso();
      await runQuery(
        `UPDATE drums SET drum_number = ?, name = ?, type = ?, size = ?, skin_id = ?, position_id = ?, 
           shift_id = ?, current_status = ?, tension = ?, wear_level = ?, 
           inspection_interval_days = ?, updated_at = ?
         WHERE id = ?`,
        [newDrumNumber, newName, newType, newSize, newSkinId, newPosId,
         newShiftId, newStatus, newTension, newWear, newInterval, now, id]
      );
    });

    const drum = await getOne(`${DRUM_JOIN} WHERE d.id = ?`, [id]);
    res.json(drum);
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.delete('/drums/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!isPosInt(id)) return res.status(400).json({ error: '无效的鼓具ID' });

    await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [id]);
      if (!drum) { const e = new Error('鼓具不存在'); e.statusCode = 404; throw e; }

      const activeUsage = await getOne(
        'SELECT id FROM usage_records WHERE drum_id = ? AND return_time IS NULL',
        [id]
      );
      if (activeUsage) {
        const e = new Error('该鼓具有未归还的借出记录，无法删除');
        e.statusCode = 400;
        throw e;
      }

      const openMaint = await getOne(
        'SELECT id FROM maintenance_records WHERE drum_id = ? AND end_time IS NULL',
        [id]
      );
      if (openMaint) {
        const e = new Error('该鼓具有未完成的维修记录，无法删除');
        e.statusCode = 400;
        throw e;
      }

      const pendingDeact = await getOne(
        'SELECT id FROM deactivation_requests WHERE drum_id = ? AND approved = 0',
        [id]
      );
      if (pendingDeact) {
        const e = new Error('该鼓具有待审批的停用申请，无法删除');
        e.statusCode = 400;
        throw e;
      }

      const pendingExt = await getOne(
        `SELECT e.id FROM extension_requests e
         JOIN usage_records u ON e.usage_record_id = u.id
         WHERE u.drum_id = ? AND e.approval_status = 'pending'`,
        [id]
      );
      if (pendingExt) {
        const e = new Error('该鼓具有待审批的延期申请，无法删除');
        e.statusCode = 400;
        throw e;
      }

      await runQuery('DELETE FROM extension_requests WHERE drum_id = ?', [id]);
      await runQuery('DELETE FROM deactivation_requests WHERE drum_id = ?', [id]);
      await runQuery('DELETE FROM maintenance_records WHERE drum_id = ?', [id]);
      await runQuery('DELETE FROM inspection_records WHERE drum_id = ?', [id]);
      await runQuery('DELETE FROM usage_records WHERE drum_id = ?', [id]);
      await runQuery('DELETE FROM drums WHERE id = ?', [id]);
    });

    res.json({ message: '鼓具已删除' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
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
    const maintId = parseInt(req.params.id, 10);
    if (!isPosInt(maintId)) return res.status(400).json({ error: '无效的维修记录ID' });

    const { notes, reinspected } = req.body;
    const reinspectFlag = toBool(reinspected);

    const result = await withTransaction(async () => {
      const recordBefore = await getOne('SELECT * FROM maintenance_records WHERE id = ?', [maintId]);
      if (!recordBefore) { const e = new Error('维修记录不存在'); e.statusCode = 404; throw e; }

      if (recordBefore.end_time !== null) {
        const e = new Error('该维修已完成，不可重复操作');
        e.statusCode = 400;
        throw e;
      }

      const shouldMarkReinspected = reinspectFlag || recordBefore.need_reinspection === 0;
      const now = nowIso();

      await runQuery(
        `UPDATE maintenance_records 
         SET end_time = ?, notes = COALESCE(?, notes),
             reinspected = ?,
             reinspection_date = CASE WHEN ? = 1 THEN ? ELSE reinspection_date END
         WHERE id = ?`,
        [now, notes || null, shouldMarkReinspected ? 1 : 0, shouldMarkReinspected ? 1 : 0, now, maintId]
      );

      const record = await getOne('SELECT * FROM maintenance_records WHERE id = ?', [maintId]);

      const otherOpenMaint = await getOne(
        `SELECT * FROM maintenance_records WHERE drum_id = ? AND id != ? AND end_time IS NULL`,
        [record.drum_id, maintId]
      );

      if (otherOpenMaint) {
        await runQuery('UPDATE drums SET current_status = ?, updated_at = ? WHERE id = ?',
          ['维护中', now, record.drum_id]);
      } else if (record.need_reinspection === 1 && record.reinspected === 0) {
        await runQuery('UPDATE drums SET current_status = ?, updated_at = ? WHERE id = ?',
          ['待巡检', now, record.drum_id]);
      } else {
        await runQuery('UPDATE drums SET current_status = ?, updated_at = ? WHERE id = ?',
          ['待领出', now, record.drum_id]);
      }

      return { record, auto_reinspected: shouldMarkReinspected && recordBefore.need_reinspection === 0 };
    });

    res.json({
      message: '维修完成',
      record: result.record,
      auto_reinspected: result.auto_reinspected
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/extension/:id/approve', async (req, res) => {
  try {
    const extId = parseInt(req.params.id, 10);
    if (!isPosInt(extId)) return res.status(400).json({ error: '无效的延期申请ID' });

    const { approved_by, approval_notes } = req.body;
    if (!isNonEmptyStr(approved_by)) {
      return res.status(400).json({ error: '参数错误: approved_by 不能为空' });
    }

    const result = await withTransaction(async () => {
      const request = await getOne('SELECT * FROM extension_requests WHERE id = ?', [extId]);
      if (!request) { const e = new Error('延期申请不存在'); e.statusCode = 404; throw e; }

      if (request.approval_status !== 'pending') {
        const e = new Error(`该申请已被${request.approval_status === 'approved' ? '批准' : '拒绝'}，不可重复审批`);
        e.statusCode = 400;
        throw e;
      }

      const usageRecord = await getOne('SELECT * FROM usage_records WHERE id = ?', [request.usage_record_id]);
      if (!usageRecord) { const e = new Error('关联的使用记录不存在'); e.statusCode = 404; throw e; }

      if (usageRecord.return_time !== null) {
        const e = new Error('该鼓具已归还，无法审批延期');
        e.statusCode = 400;
        throw e;
      }

      const drum = await getOne('SELECT current_status FROM drums WHERE id = ?', [request.drum_id]);
      if (!drum || drum.current_status !== '已领出') {
        const e = new Error('该鼓具当前不是借出状态，无法批准延期');
        e.statusCode = 400;
        throw e;
      }

      const now = nowIso();

      await runQuery(
        `UPDATE extension_requests 
         SET approval_status = 'approved', approved_by = ?, approved_at = ?, approval_notes = ?
         WHERE id = ?`,
        [approved_by.trim(), now, approval_notes || null, extId]
      );

      await runQuery(
        `UPDATE usage_records SET expected_return_time = ? WHERE id = ?`,
        [request.new_expected_return_time, request.usage_record_id]
      );

      return await getOne(`
        SELECT e.*, d.drum_number, d.name as drum_name, u.expected_return_time as current_expected_return_time
        FROM extension_requests e
        JOIN drums d ON e.drum_id = d.id
        JOIN usage_records u ON e.usage_record_id = u.id
        WHERE e.id = ?
      `, [extId]);
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
    const extId = parseInt(req.params.id, 10);
    if (!isPosInt(extId)) return res.status(400).json({ error: '无效的延期申请ID' });

    const { approved_by, approval_notes } = req.body;
    if (!isNonEmptyStr(approved_by)) {
      return res.status(400).json({ error: '参数错误: approved_by 不能为空' });
    }

    const result = await withTransaction(async () => {
      const request = await getOne('SELECT * FROM extension_requests WHERE id = ?', [extId]);
      if (!request) { const e = new Error('延期申请不存在'); e.statusCode = 404; throw e; }

      if (request.approval_status !== 'pending') {
        const e = new Error(`该申请已被${request.approval_status === 'approved' ? '批准' : '拒绝'}，不可重复审批`);
        e.statusCode = 400;
        throw e;
      }

      const now = nowIso();
      await runQuery(
        `UPDATE extension_requests 
         SET approval_status = 'rejected', approved_by = ?, approved_at = ?, approval_notes = ?, new_expected_return_time = NULL
         WHERE id = ?`,
        [approved_by.trim(), now, approval_notes || null, extId]
      );

      return await getOne(`
        SELECT e.*, d.drum_number, d.name as drum_name, u.expected_return_time as current_expected_return_time
        FROM extension_requests e
        JOIN drums d ON e.drum_id = d.id
        JOIN usage_records u ON e.usage_record_id = u.id
        WHERE e.id = ?
      `, [extId]);
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
      const id = parseInt(drum_id, 10);
      if (isPosInt(id)) {
        sql += ` AND e.drum_id = ?`;
        params.push(id);
      }
    }
    if (staff_name) {
      sql += ` AND (e.staff_name LIKE ? OR u.staff_name LIKE ?)`;
      params.push(`%${staff_name}%`, `%${staff_name}%`);
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
