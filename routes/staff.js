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

const parseNumber = (val) => {
  if (val === undefined || val === null || val === '') return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return n;
};

const isNonEmptyString = (val) => typeof val === 'string' && val.trim().length > 0;

const isValidWearLevel = (val) => {
  if (val === undefined || val === null) return true;
  const n = Number(val);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0 && n <= 10;
};

router.post('/checkout', async (req, res) => {
  try {
    const { drum_id, staff_name, shift_id, purpose, expected_return_hours } = req.body;

    const drumId = parseId(drum_id);
    if (!drumId) {
      return res.status(400).json({ error: '参数错误: drum_id 必须为正整数' });
    }
    if (!isNonEmptyString(staff_name)) {
      return res.status(400).json({ error: '参数错误: staff_name 不可为空' });
    }
    const shiftIdParsed = shift_id === undefined || shift_id === null || shift_id === ''
      ? null
      : parseId(shift_id);
    if (shift_id !== undefined && shift_id !== null && shift_id !== '' && shiftIdParsed === null) {
      return res.status(400).json({ error: '参数错误: shift_id 必须为正整数' });
    }

    let expectedReturnHours = 4;
    if (expected_return_hours !== undefined && expected_return_hours !== null && expected_return_hours !== '') {
      const ehrs = parseNumber(expected_return_hours);
      if (ehrs === null || ehrs <= 0 || ehrs > 24 * 30) {
        return res.status(400).json({ error: '参数错误: expected_return_hours 必须是 0 ~ 720 之间的数字' });
      }
      expectedReturnHours = ehrs;
    }

    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
      if (!drum) {
        const err = new Error('Drum not found');
        err.statusCode = 404;
        throw err;
      }

      if (drum.current_status === '已领出') {
        const err = new Error('该鼓具已被领出，不可重复领出');
        err.statusCode = 400;
        throw err;
      }

      if (!['待领出', '恢复可用'].includes(drum.current_status)) {
        const err = new Error(`当前状态为"${drum.current_status}"，不可领出`);
        err.statusCode = 400;
        throw err;
      }

      const activeUsage = await getOne(`
        SELECT * FROM usage_records 
        WHERE drum_id = ? AND return_time IS NULL
      `, [drumId]);

      if (activeUsage) {
        const err = new Error('该鼓具存在未归还记录，请先确认归位');
        err.statusCode = 400;
        throw err;
      }

      const now = nowISO();
      const expectedReturnTime = new Date(Date.now() + expectedReturnHours * 60 * 60 * 1000).toISOString();

      await runQuery(
        `INSERT INTO usage_records 
         (drum_id, staff_name, shift_id, purpose, checkout_time, expected_return_time, tension_before, wear_before)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [drumId, staff_name, shiftIdParsed, purpose || null, now, expectedReturnTime, drum.tension, drum.wear_level]
      );

      await runQuery(
        `UPDATE drums SET current_status = '已领出', total_uses = total_uses + 1, updated_at = ? WHERE id = ?`,
        [now, drumId]
      );

      return await getOne(`
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
    });

    res.json({ message: '领出成功', drum: result });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/return', async (req, res) => {
  try {
    const { drum_id, staff_name, tension_after, wear_after, edge_wear, notes } = req.body;

    const drumId = parseId(drum_id);
    if (!drumId) {
      return res.status(400).json({ error: '参数错误: drum_id 必须为正整数' });
    }
    if (!isNonEmptyString(staff_name)) {
      return res.status(400).json({ error: '参数错误: staff_name 不可为空' });
    }
    if (!isValidWearLevel(wear_after)) {
      return res.status(400).json({ error: '参数错误: wear_after 必须是 0 ~ 10 的整数' });
    }

    const wearAfterProvided = wear_after !== undefined && wear_after !== null && wear_after !== '';
    const wearAfterValue = wearAfterProvided ? parseInteger(wear_after) : null;

    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
      if (!drum) {
        const err = new Error('Drum not found');
        err.statusCode = 404;
        throw err;
      }

      if (drum.current_status !== '已领出') {
        const err = new Error(`当前状态为"${drum.current_status}"，不可执行归位操作`);
        err.statusCode = 400;
        throw err;
      }

      const usageRecord = await getOne(`
        SELECT * FROM usage_records 
        WHERE drum_id = ? AND return_time IS NULL
        ORDER BY checkout_time DESC LIMIT 1
      `, [drumId]);

      if (!usageRecord) {
        const err = new Error('未找到对应的领出记录');
        err.statusCode = 400;
        throw err;
      }

      const now = new Date();
      const nowIso = now.toISOString();

      let is_overdue = 0;
      if (usageRecord.expected_return_time) {
        const expectedTime = new Date(usageRecord.expected_return_time);
        if (now > expectedTime) {
          is_overdue = 1;
        }
      }

      // 自动拒绝该使用记录上未审批的延期申请，避免后续状态错乱
      await runQuery(
        `UPDATE extension_requests 
         SET approval_status = 'rejected', 
             approved_at = ?, 
             approval_notes = COALESCE(approval_notes, '已归还，自动关闭')
         WHERE usage_record_id = ? AND approval_status = 'pending'`,
        [nowIso, usageRecord.id]
      );

      await runQuery(
        `UPDATE usage_records 
         SET return_time = ?, 
             tension_after = ?, 
             wear_after = ?, 
             edge_wear = ?, 
             notes = ?,
             is_overdue = ?
         WHERE id = ?`,
        [nowIso, tension_after || null, wearAfterProvided ? wearAfterValue : null, edge_wear || null, notes || null, is_overdue, usageRecord.id]
      );

      // wear_after=0 是合法值；只有未提供时才回退
      const effectiveWear = wearAfterProvided ? wearAfterValue : drum.wear_level;
      const newStatus = (wearAfterProvided && wearAfterValue >= 7) ? '待巡检' : '待领出';

      await runQuery(
        `UPDATE drums 
         SET current_status = ?, tension = ?, wear_level = ?, updated_at = ? 
         WHERE id = ?`,
        [newStatus, tension_after || drum.tension, effectiveWear, nowIso, drumId]
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

      return { drum: updatedDrum, is_overdue, newStatus };
    });

    res.json({
      message: '归位成功',
      is_overdue: result.is_overdue === 1,
      needs_inspection: result.newStatus === '待巡检',
      drum: result.drum
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/inspect', async (req, res) => {
  try {
    const { drum_id, staff_name, shift_id, tension, wear_level, edge_wear, needs_repair, repair_notes, notes, force } = req.body;

    const drumId = parseId(drum_id);
    if (!drumId) {
      return res.status(400).json({ error: '参数错误: drum_id 必须为正整数' });
    }
    if (!isNonEmptyString(staff_name)) {
      return res.status(400).json({ error: '参数错误: staff_name 不可为空' });
    }
    if (!isValidWearLevel(wear_level)) {
      return res.status(400).json({ error: '参数错误: wear_level 必须是 0 ~ 10 的整数' });
    }
    const shiftIdParsed = shift_id === undefined || shift_id === null || shift_id === ''
      ? null
      : parseId(shift_id);
    if (shift_id !== undefined && shift_id !== null && shift_id !== '' && shiftIdParsed === null) {
      return res.status(400).json({ error: '参数错误: shift_id 必须为正整数' });
    }

    const wearLevelProvided = wear_level !== undefined && wear_level !== null && wear_level !== '';
    const wearLevelValue = wearLevelProvided ? parseInteger(wear_level) : null;

    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
      if (!drum) {
        const err = new Error('Drum not found');
        err.statusCode = 404;
        throw err;
      }

      if (drum.current_status === '已领出') {
        const err = new Error('该鼓具尚未归还，不可巡检');
        err.statusCode = 400;
        throw err;
      }
      if (drum.current_status === '停用中') {
        const err = new Error('该鼓具已停用，不可巡检');
        err.statusCode = 400;
        throw err;
      }

      const warnings = [];
      let inspectionTiming = null;
      const now = new Date();
      const nowIso = now.toISOString();
      const intervalDays = drum.inspection_interval_days || 7;

      if (drum.last_inspection_date) {
        const lastInspect = new Date(drum.last_inspection_date);
        const daysSinceLast = Math.floor((now - lastInspect) / (1000 * 60 * 60 * 24));
        const expectedNext = new Date(lastInspect.getTime() + intervalDays * 24 * 60 * 60 * 1000);
        const daysUntilNext = Math.ceil((expectedNext - now) / (1000 * 60 * 60 * 24));

        if (daysUntilNext > 1 && drum.current_status !== '待巡检' && !force) {
          const err = new Error('还未到巡检节点');
          err.statusCode = 400;
          err.details = {
            last_inspection: drum.last_inspection_date,
            interval_days: intervalDays,
            days_since_last: daysSinceLast,
            days_until_next: daysUntilNext,
            suggestion: '如需提前巡检，请传入 force: true 参数'
          };
          throw err;
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

      await runQuery(
        `INSERT INTO inspection_records 
         (drum_id, staff_name, shift_id, tension, wear_level, edge_wear, needs_repair, repair_notes, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [drumId, staff_name, shiftIdParsed, tension || null, wearLevelProvided ? wearLevelValue : null,
         edge_wear || null, needs_repair ? 1 : 0, repair_notes || null, notes || null, nowIso]
      );

      if (pendingMaintenance.length > 0) {
        await runQuery(
          `UPDATE maintenance_records 
           SET reinspected = 1, reinspection_date = ?
           WHERE drum_id = ? AND need_reinspection = 1 AND reinspected = 0`,
          [nowIso, drumId]
        );
      }

      let newStatus = drum.current_status;
      if (needs_repair) {
        newStatus = '维护中';
      } else if (drum.current_status === '待巡检' || drum.current_status === '恢复可用') {
        newStatus = '待领出';
      }

      const finalWear = wearLevelProvided ? wearLevelValue : drum.wear_level;

      await runQuery(
        `UPDATE drums 
         SET current_status = ?, tension = ?, wear_level = ?, 
             last_inspection_date = ?, updated_at = ? 
         WHERE id = ?`,
        [newStatus, tension || drum.tension, finalWear, nowIso, nowIso, drumId]
      );

      if (needs_repair) {
        await runQuery(
          `INSERT INTO maintenance_records 
           (drum_id, staff_name, type, description, need_reinspection, start_time, created_at)
           VALUES (?, ?, '巡检报修', ?, 1, ?, ?)`,
          [drumId, staff_name, repair_notes || '巡检发现需要维修', nowIso, nowIso]
        );
      }

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
        drum: updatedDrum,
        warnings,
        inspectionTiming,
        reinspected_maintenance: pendingMaintenance.length
      };
    });

    res.json({
      message: '巡检记录已保存',
      needs_maintenance: !!needs_repair,
      reinspected_maintenance: result.reinspected_maintenance,
      inspection_timing: result.inspectionTiming,
      warnings: result.warnings,
      drum: result.drum
    });
  } catch (err) {
    const body = { error: err.message };
    if (err.details) body.details = err.details;
    res.status(err.statusCode || 400).json(body);
  }
});

router.post('/repair', async (req, res) => {
  try {
    const { drum_id, staff_name, description, skin_replaced, new_skin_id, need_reinspection } = req.body;

    const drumId = parseId(drum_id);
    if (!drumId) {
      return res.status(400).json({ error: '参数错误: drum_id 必须为正整数' });
    }
    if (!isNonEmptyString(staff_name)) {
      return res.status(400).json({ error: '参数错误: staff_name 不可为空' });
    }

    let newSkinIdParsed = null;
    if (skin_replaced && (new_skin_id === undefined || new_skin_id === null || new_skin_id === '')) {
      return res.status(400).json({ error: '参数错误: 已勾选更换鼓皮但缺少 new_skin_id' });
    }
    if (new_skin_id !== undefined && new_skin_id !== null && new_skin_id !== '') {
      newSkinIdParsed = parseId(new_skin_id);
      if (newSkinIdParsed === null) {
        return res.status(400).json({ error: '参数错误: new_skin_id 必须为正整数' });
      }
    }

    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
      if (!drum) {
        const err = new Error('Drum not found');
        err.statusCode = 404;
        throw err;
      }

      if (drum.current_status === '已领出') {
        const err = new Error('该鼓具仍处于领出状态，不可直接维修，请先归位');
        err.statusCode = 400;
        throw err;
      }
      if (drum.current_status === '停用中') {
        const err = new Error('该鼓具已停用，不可维修');
        err.statusCode = 400;
        throw err;
      }

      if (newSkinIdParsed !== null) {
        const skin = await getOne('SELECT id FROM drum_skins WHERE id = ?', [newSkinIdParsed]);
        if (!skin) {
          const err = new Error('指定的鼓皮批次不存在');
          err.statusCode = 400;
          throw err;
        }
      }

      const nowIso = nowISO();

      const insertResult = await runQuery(
        `INSERT INTO maintenance_records 
         (drum_id, staff_name, type, description, skin_replaced, new_skin_id, need_reinspection, start_time, created_at)
         VALUES (?, ?, '补皮/维修', ?, ?, ?, ?, ?, ?)`,
        [drumId, staff_name, description || null, skin_replaced ? 1 : 0,
         newSkinIdParsed, need_reinspection ? 1 : 0, nowIso, nowIso]
      );

      if (skin_replaced && newSkinIdParsed) {
        await runQuery(
          `UPDATE drums SET skin_id = ?, wear_level = 0, updated_at = ? WHERE id = ?`,
          [newSkinIdParsed, nowIso, drumId]
        );
      }

      await runQuery(
        `UPDATE drums SET current_status = '维护中', updated_at = ? WHERE id = ?`,
        [nowIso, drumId]
      );

      const maintenanceRecord = await getOne('SELECT * FROM maintenance_records WHERE id = ?', [insertResult.id]);
      return { maintenanceRecord };
    });

    res.json({
      message: '补皮/维修记录已创建',
      maintenance: result.maintenanceRecord,
      need_reinspection: !!need_reinspection
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/deactivate', async (req, res) => {
  try {
    const { drum_id, staff_name, reason } = req.body;

    const drumId = parseId(drum_id);
    if (!drumId) {
      return res.status(400).json({ error: '参数错误: drum_id 必须为正整数' });
    }
    if (!isNonEmptyString(staff_name)) {
      return res.status(400).json({ error: '参数错误: staff_name 不可为空' });
    }
    if (!isNonEmptyString(reason)) {
      return res.status(400).json({ error: '参数错误: reason 不可为空' });
    }

    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
      if (!drum) {
        const err = new Error('Drum not found');
        err.statusCode = 404;
        throw err;
      }

      if (drum.current_status === '停用中') {
        const err = new Error('该鼓具已处于停用状态');
        err.statusCode = 400;
        throw err;
      }
      if (drum.current_status === '已领出') {
        const err = new Error('该鼓具尚未归还，不可申请停用');
        err.statusCode = 400;
        throw err;
      }
      if (drum.current_status === '维护中') {
        const err = new Error('该鼓具维护中，请等维护完成后再申请停用');
        err.statusCode = 400;
        throw err;
      }

      const pending = await getOne(
        `SELECT id FROM deactivation_requests WHERE drum_id = ? AND approved = 0`,
        [drumId]
      );
      if (pending) {
        const err = new Error('该鼓具已存在待审批的停用申请');
        err.statusCode = 400;
        throw err;
      }

      const insertResult = await runQuery(
        `INSERT INTO deactivation_requests (drum_id, staff_name, reason, created_at) VALUES (?, ?, ?, ?)`,
        [drumId, staff_name, reason, nowISO()]
      );
      return { request_id: insertResult.id };
    });

    res.json({ message: '停用申请已提交，等待审批', request_id: result.request_id });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/deactivate/:id/approve', async (req, res) => {
  try {
    const { approved_by } = req.body;
    const reqId = parseId(req.params.id);
    if (!reqId) {
      return res.status(400).json({ error: '参数错误: id 必须为正整数' });
    }
    if (!isNonEmptyString(approved_by)) {
      return res.status(400).json({ error: '参数错误: approved_by 不可为空' });
    }

    await withTransaction(async () => {
      const request = await getOne('SELECT * FROM deactivation_requests WHERE id = ?', [reqId]);
      if (!request) {
        const err = new Error('Request not found');
        err.statusCode = 404;
        throw err;
      }

      if (request.approved === 1) {
        const err = new Error('该申请已审批');
        err.statusCode = 400;
        throw err;
      }

      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [request.drum_id]);
      if (!drum) {
        const err = new Error('鼓具不存在');
        err.statusCode = 404;
        throw err;
      }
      if (drum.current_status === '已领出') {
        const err = new Error('该鼓具仍处于领出状态，不可批准停用');
        err.statusCode = 400;
        throw err;
      }
      if (drum.current_status === '维护中') {
        const err = new Error('该鼓具维护中，不可批准停用');
        err.statusCode = 400;
        throw err;
      }

      const nowIso = nowISO();
      await runQuery(
        `UPDATE deactivation_requests 
         SET approved = 1, approved_by = ?, approved_at = ? 
         WHERE id = ?`,
        [approved_by, nowIso, reqId]
      );

      await runQuery(
        `UPDATE drums SET current_status = '停用中', updated_at = ? WHERE id = ?`,
        [nowIso, request.drum_id]
      );
    });

    res.json({ message: '停用申请已批准，鼓具已停用' });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/reactivate', async (req, res) => {
  try {
    const { drum_id, staff_name } = req.body;

    const drumId = parseId(drum_id);
    if (!drumId) {
      return res.status(400).json({ error: '参数错误: drum_id 必须为正整数' });
    }
    if (!isNonEmptyString(staff_name)) {
      return res.status(400).json({ error: '参数错误: staff_name 不可为空' });
    }

    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
      if (!drum) {
        const err = new Error('Drum not found');
        err.statusCode = 404;
        throw err;
      }

      if (drum.current_status !== '停用中') {
        const err = new Error(`当前状态为"${drum.current_status}"，不可恢复`);
        err.statusCode = 400;
        throw err;
      }

      const nowIso = nowISO();
      await runQuery(
        `UPDATE drums SET current_status = '恢复可用', updated_at = ? WHERE id = ?`,
        [nowIso, drumId]
      );

      await runQuery(
        `INSERT INTO inspection_records 
         (drum_id, staff_name, tension, wear_level, notes, created_at)
         VALUES (?, ?, ?, ?, '停用恢复，建议进行全面检查', ?)`,
        [drumId, staff_name, drum.tension, drum.wear_level, nowIso]
      );

      return await getOne(`
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
    });

    res.json({ message: '鼓具已恢复可用，建议进行全面检查', drum: result });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
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

    const drumId = parseId(drum_id);
    if (!drumId) {
      return res.status(400).json({ error: '参数错误: drum_id 必须为正整数' });
    }
    if (!isNonEmptyString(staff_name)) {
      return res.status(400).json({ error: '参数错误: staff_name 不可为空' });
    }
    if (!isNonEmptyString(reason)) {
      return res.status(400).json({ error: '参数错误: reason 不可为空' });
    }
    const extHours = parseNumber(extension_hours);
    if (extHours === null || extHours <= 0 || extHours > 24 * 30) {
      return res.status(400).json({ error: '参数错误: extension_hours 必须是 0 ~ 720 之间的数字' });
    }

    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drumId]);
      if (!drum) {
        const err = new Error('鼓具不存在');
        err.statusCode = 404;
        throw err;
      }

      if (drum.current_status !== '已领出') {
        const err = new Error(`当前状态为"${drum.current_status}"，不可申请延期`);
        err.statusCode = 400;
        throw err;
      }

      const usageRecord = await getOne(`
        SELECT * FROM usage_records
        WHERE drum_id = ? AND return_time IS NULL
        ORDER BY checkout_time DESC LIMIT 1
      `, [drumId]);

      if (!usageRecord) {
        const err = new Error('未找到对应的领出记录');
        err.statusCode = 400;
        throw err;
      }

      if (usageRecord.staff_name !== staff_name) {
        const err = new Error('只有领用人本人才能申请延期');
        err.statusCode = 403;
        err.details = { borrower: usageRecord.staff_name, applicant: staff_name };
        throw err;
      }

      const pendingExtension = await getOne(`
        SELECT * FROM extension_requests
        WHERE usage_record_id = ? AND approval_status = 'pending'
      `, [usageRecord.id]);

      if (pendingExtension) {
        const err = new Error('该借用已有待审批的延期申请，请等待审批');
        err.statusCode = 400;
        throw err;
      }

      // 当前预计归还时间（已包含此前已批准延期的累计结果）
      const currentExpectedReturn = usageRecord.expected_return_time;
      if (!currentExpectedReturn) {
        const err = new Error('当前借用记录缺少预计归还时间，无法申请延期');
        err.statusCode = 400;
        throw err;
      }

      const newExpectedReturn = new Date(new Date(currentExpectedReturn).getTime() + extHours * 60 * 60 * 1000).toISOString();

      const insertResult = await runQuery(
        `INSERT INTO extension_requests
         (usage_record_id, drum_id, staff_name, extension_hours, reason, original_expected_return_time, new_expected_return_time, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [usageRecord.id, drumId, staff_name, extHours, reason, currentExpectedReturn, newExpectedReturn, nowISO()]
      );

      return await getOne(`
        SELECT e.*, d.drum_number, d.name as drum_name, u.expected_return_time as current_expected_return_time
        FROM extension_requests e
        JOIN drums d ON e.drum_id = d.id
        JOIN usage_records u ON e.usage_record_id = u.id
        WHERE e.id = ?
      `, [insertResult.id]);
    });

    res.json({
      message: '延期申请已提交，等待审批',
      request_id: result.id,
      extension: result
    });
  } catch (err) {
    const body = { error: err.message };
    if (err.details) body.details = err.details;
    res.status(err.statusCode || 400).json(body);
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
