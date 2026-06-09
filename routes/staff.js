const express = require('express');
const router = express.Router();
const {
  db, runQuery, getQuery, getOne, withTransaction, nowIso,
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

router.post('/checkout', async (req, res) => {
  try {
    const { drum_id, staff_name, shift_id, purpose, expected_return_hours } = req.body;

    if (!isPosInt(drum_id)) {
      return res.status(400).json({ error: '参数错误: drum_id 必须为正整数' });
    }
    if (!isNonEmptyStr(staff_name)) {
      return res.status(400).json({ error: '参数错误: staff_name 不能为空' });
    }
    if (shift_id !== undefined && shift_id !== null && !isPosInt(shift_id)) {
      return res.status(400).json({ error: '参数错误: shift_id 必须为正整数或空' });
    }

    const hours = expected_return_hours !== undefined && expected_return_hours !== null
      ? Number(expected_return_hours)
      : 4;
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
      return res.status(400).json({ error: '参数错误: expected_return_hours 必须为正数（不超过720小时）' });
    }

    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drum_id]);
      if (!drum) {
        const e = new Error('鼓具不存在');
        e.statusCode = 404;
        throw e;
      }

      if (drum.current_status === '已领出') {
        const e = new Error('该鼓具已被领出，不可重复借出');
        e.statusCode = 400;
        throw e;
      }
      if (!['待领出', '恢复可用'].includes(drum.current_status)) {
        const e = new Error(`当前状态为"${drum.current_status}"，不可领出`);
        e.statusCode = 400;
        throw e;
      }

      const activeUsage = await getOne(
        `SELECT * FROM usage_records WHERE drum_id = ? AND return_time IS NULL`,
        [drum_id]
      );
      if (activeUsage) {
        const e = new Error('该鼓具存在未归还记录，请先确认归位');
        e.statusCode = 400;
        throw e;
      }

      const pendingDeact = await getOne(
        `SELECT * FROM deactivation_requests WHERE drum_id = ? AND approved = 0`,
        [drum_id]
      );
      if (pendingDeact) {
        const e = new Error('该鼓具有待审批的停用申请，不可借出');
        e.statusCode = 400;
        throw e;
      }

      const now = nowIso();
      const expectedReturnTime = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

      await runQuery(
        `INSERT INTO usage_records 
         (drum_id, staff_name, shift_id, purpose, checkout_time, expected_return_time, tension_before, wear_before, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [drum_id, staff_name.trim(), shift_id || null, purpose || null, now, expectedReturnTime, drum.tension, drum.wear_level, now]
      );

      await runQuery(
        `UPDATE drums SET current_status = '已领出', total_uses = total_uses + 1, updated_at = ? WHERE id = ?`,
        [now, drum_id]
      );

      return await getOne(`${DRUM_JOIN} WHERE d.id = ?`, [drum_id]);
    });

    res.json({ message: '领出成功', drum: result });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/return', async (req, res) => {
  try {
    const { drum_id, staff_name, tension_after, wear_after, edge_wear, notes } = req.body;

    if (!isPosInt(drum_id)) {
      return res.status(400).json({ error: '参数错误: drum_id 必须为正整数' });
    }

    if (wear_after !== undefined && wear_after !== null) {
      const wa = Number(wear_after);
      if (!Number.isInteger(wa) || wa < 0 || wa > 10) {
        return res.status(400).json({ error: '参数错误: wear_after 必须为0-10之间的整数' });
      }
    }

    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drum_id]);
      if (!drum) {
        const e = new Error('鼓具不存在');
        e.statusCode = 404;
        throw e;
      }

      if (drum.current_status !== '已领出') {
        const e = new Error(`当前状态为"${drum.current_status}"，不可执行归位操作`);
        e.statusCode = 400;
        throw e;
      }

      const usageRecord = await getOne(
        `SELECT * FROM usage_records WHERE drum_id = ? AND return_time IS NULL ORDER BY checkout_time DESC LIMIT 1`,
        [drum_id]
      );
      if (!usageRecord) {
        const e = new Error('未找到对应的领出记录');
        e.statusCode = 400;
        throw e;
      }

      const now = new Date();
      let is_overdue = 0;
      if (usageRecord.expected_return_time) {
        const expectedTime = new Date(usageRecord.expected_return_time);
        if (now > expectedTime) {
          is_overdue = 1;
        }
      }

      const wearAfterVal = (wear_after !== undefined && wear_after !== null)
        ? Number(wear_after)
        : null;
      const newWearLevel = wearAfterVal !== null ? wearAfterVal : drum.wear_level;
      const newStatus = (wearAfterVal !== null && wearAfterVal >= 7) ? '待巡检' : '待领出';

      const nowIsoStr = nowIso();

      await runQuery(
        `UPDATE usage_records 
         SET return_time = ?, tension_after = ?, wear_after = ?, edge_wear = ?, notes = ?, is_overdue = ?
         WHERE id = ?`,
        [nowIsoStr, tension_after || null, wearAfterVal, edge_wear || null, notes || null, is_overdue, usageRecord.id]
      );

      await runQuery(
        `UPDATE drums SET current_status = ?, tension = ?, wear_level = ?, updated_at = ? WHERE id = ?`,
        [newStatus, tension_after || drum.tension, newWearLevel, nowIsoStr, drum_id]
      );

      const updatedDrum = await getOne(`${DRUM_JOIN} WHERE d.id = ?`, [drum_id]);

      return {
        drum: updatedDrum,
        is_overdue: is_overdue === 1,
        needs_inspection: newStatus === '待巡检'
      };
    });

    res.json({
      message: '归位成功',
      is_overdue: result.is_overdue,
      needs_inspection: result.needs_inspection,
      drum: result.drum
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/inspect', async (req, res) => {
  try {
    const { drum_id, staff_name, shift_id, tension, wear_level, edge_wear, needs_repair, repair_notes, notes, force } = req.body;

    if (!isPosInt(drum_id)) {
      return res.status(400).json({ error: '参数错误: drum_id 必须为正整数' });
    }
    if (!isNonEmptyStr(staff_name)) {
      return res.status(400).json({ error: '参数错误: staff_name 不能为空' });
    }
    if (shift_id !== undefined && shift_id !== null && !isPosInt(shift_id)) {
      return res.status(400).json({ error: '参数错误: shift_id 必须为正整数或空' });
    }

    const wl = wear_level !== undefined && wear_level !== null ? Number(wear_level) : null;
    if (wl !== null && !isValidWearLevel(wl)) {
      return res.status(400).json({ error: '参数错误: wear_level 必须为0-10之间的整数' });
    }

    const needsRepair = toBool(needs_repair);
    const forceFlag = toBool(force);

    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drum_id]);
      if (!drum) {
        const e = new Error('鼓具不存在');
        e.statusCode = 404;
        throw e;
      }

      if (drum.current_status === '停用中' || drum.current_status === '停用申请中') {
        const e = new Error('鼓具已停用或待审批停用，不可巡检');
        e.statusCode = 400;
        throw e;
      }

      const warnings = [];
      let inspectionTiming = null;
      const now = new Date();
      const intervalDays = Number.isInteger(drum.inspection_interval_days) && drum.inspection_interval_days > 0
        ? drum.inspection_interval_days
        : 7;

      if (drum.last_inspection_date) {
        const lastInspect = new Date(drum.last_inspection_date);
        if (isNaN(lastInspect.getTime())) {
          inspectionTiming = 'first';
          warnings.push('上次巡检时间格式异常，按首次巡检处理');
        } else {
          const daysSinceLast = Math.floor((now - lastInspect) / (1000 * 60 * 60 * 24));
          const expectedNext = new Date(lastInspect.getTime() + intervalDays * 24 * 60 * 60 * 1000);
          const daysUntilNext = Math.ceil((expectedNext - now) / (1000 * 60 * 60 * 24));

          if (daysUntilNext > 1 && drum.current_status !== '待巡检' && !forceFlag) {
            const e = new Error('还未到巡检节点');
            e.statusCode = 400;
            e.details = {
              last_inspection: drum.last_inspection_date,
              interval_days: intervalDays,
              days_since_last: daysSinceLast,
              days_until_next: daysUntilNext,
              suggestion: '如需提前巡检，请传入 force: true 参数'
            };
            throw e;
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
        }
      } else {
        inspectionTiming = 'first';
        warnings.push('首次巡检');
      }

      if (drum.current_status !== '待巡检' && drum.current_status !== '恢复可用' && drum.current_status !== '维护中') {
        warnings.push(`当前状态为"${drum.current_status}"，非待巡检状态`);
      }

      const pendingMaintenance = await getQuery(
        `SELECT * FROM maintenance_records WHERE drum_id = ? AND need_reinspection = 1 AND reinspected = 0 ORDER BY created_at DESC`,
        [drum_id]
      );

      const nowIsoStr = nowIso();
      const resolvedWearLevel = wl !== null ? wl : drum.wear_level;
      const resolvedTension = tension !== undefined && tension !== null ? tension : drum.tension;

      await runQuery(
        `INSERT INTO inspection_records 
         (drum_id, staff_name, shift_id, tension, wear_level, edge_wear, needs_repair, repair_notes, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [drum_id, staff_name.trim(), shift_id || null, resolvedTension, resolvedWearLevel, edge_wear || null, needsRepair ? 1 : 0, repair_notes || null, notes || null, nowIsoStr]
      );

      let reinspectedCount = 0;
      if (pendingMaintenance.length > 0) {
        const reinspectRes = await runQuery(
          `UPDATE maintenance_records SET reinspected = 1, reinspection_date = ? WHERE drum_id = ? AND need_reinspection = 1 AND reinspected = 0`,
          [nowIsoStr, drum_id]
        );
        reinspectedCount = reinspectRes.changes;
      }

      let newStatus = drum.current_status;
      if (needsRepair) {
        newStatus = '维护中';
      } else if (drum.current_status === '待巡检' || drum.current_status === '恢复可用') {
        newStatus = '待领出';
      } else if (drum.current_status === '维护中') {
        const openMaint = await getOne(
          `SELECT * FROM maintenance_records WHERE drum_id = ? AND end_time IS NULL`,
          [drum_id]
        );
        if (!openMaint) {
          newStatus = '待领出';
        }
      }

      await runQuery(
        `UPDATE drums SET current_status = ?, tension = ?, wear_level = ?, last_inspection_date = ?, updated_at = ? WHERE id = ?`,
        [newStatus, resolvedTension, resolvedWearLevel, nowIsoStr, nowIsoStr, drum_id]
      );

      if (needsRepair) {
        await runQuery(
          `INSERT INTO maintenance_records 
           (drum_id, staff_name, type, description, need_reinspection, start_time, created_at)
           VALUES (?, ?, '巡检报修', ?, 1, ?, ?)`,
          [drum_id, staff_name.trim(), repair_notes || '巡检发现需要维修', nowIsoStr, nowIsoStr]
        );
      }

      const updatedDrum = await getOne(`${DRUM_JOIN} WHERE d.id = ?`, [drum_id]);

      return {
        drum: updatedDrum,
        needs_maintenance: needsRepair,
        reinspected_maintenance: reinspectedCount,
        inspection_timing: inspectionTiming,
        warnings
      };
    });

    res.json({
      message: '巡检记录已保存',
      needs_maintenance: result.needs_maintenance,
      reinspected_maintenance: result.reinspected_maintenance,
      inspection_timing: result.inspection_timing,
      warnings: result.warnings,
      drum: result.drum
    });
  } catch (err) {
    const status = err.statusCode || 400;
    const resp = { error: err.message };
    if (err.details) resp.details = err.details;
    res.status(status).json(resp);
  }
});

router.post('/repair', async (req, res) => {
  try {
    const { drum_id, staff_name, description, skin_replaced, new_skin_id, need_reinspection } = req.body;

    if (!isPosInt(drum_id)) {
      return res.status(400).json({ error: '参数错误: drum_id 必须为正整数' });
    }
    if (!isNonEmptyStr(staff_name)) {
      return res.status(400).json({ error: '参数错误: staff_name 不能为空' });
    }

    const skinReplaced = toBool(skin_replaced);
    const needReinspection = toBool(need_reinspection);

    if (skinReplaced) {
      if (!isPosInt(new_skin_id)) {
        return res.status(400).json({ error: '参数错误: 更换鼓皮时 new_skin_id 必须为正整数' });
      }
    }

    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drum_id]);
      if (!drum) {
        const e = new Error('鼓具不存在');
        e.statusCode = 404;
        throw e;
      }

      if (drum.current_status === '停用中' || drum.current_status === '停用申请中') {
        const e = new Error('鼓具已停用或待审批停用，不可进行维修操作');
        e.statusCode = 400;
        throw e;
      }

      if (skinReplaced && new_skin_id) {
        const skin = await getOne('SELECT * FROM drum_skins WHERE id = ?', [new_skin_id]);
        if (!skin) {
          const e = new Error('指定的鼓皮不存在');
          e.statusCode = 400;
          throw e;
        }
      }

      const now = nowIso();

      const insertRes = await runQuery(
        `INSERT INTO maintenance_records 
         (drum_id, staff_name, type, description, skin_replaced, new_skin_id, need_reinspection, start_time, created_at)
         VALUES (?, ?, '补皮/维修', ?, ?, ?, ?, ?, ?)`,
        [drum_id, staff_name.trim(), description || null, skinReplaced ? 1 : 0, skinReplaced ? new_skin_id : null, needReinspection ? 1 : 0, now, now]
      );

      if (skinReplaced && new_skin_id) {
        await runQuery(
          `UPDATE drums SET skin_id = ?, wear_level = 0, updated_at = ? WHERE id = ?`,
          [new_skin_id, now, drum_id]
        );
      }

      await runQuery(
        `UPDATE drums SET current_status = '维护中', updated_at = ? WHERE id = ?`,
        [now, drum_id]
      );

      return await getOne('SELECT * FROM maintenance_records WHERE id = ?', [insertRes.id]);
    });

    res.json({
      message: '补皮/维修记录已创建',
      maintenance: result,
      need_reinspection: needReinspection
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/deactivate', async (req, res) => {
  try {
    const { drum_id, staff_name, reason } = req.body;

    if (!isPosInt(drum_id)) {
      return res.status(400).json({ error: '参数错误: drum_id 必须为正整数' });
    }
    if (!isNonEmptyStr(staff_name)) {
      return res.status(400).json({ error: '参数错误: staff_name 不能为空' });
    }
    if (!isNonEmptyStr(reason)) {
      return res.status(400).json({ error: '参数错误: reason 不能为空' });
    }

    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drum_id]);
      if (!drum) {
        const e = new Error('鼓具不存在');
        e.statusCode = 404;
        throw e;
      }

      if (drum.current_status === '停用中') {
        const e = new Error('该鼓具已处于停用状态');
        e.statusCode = 400;
        throw e;
      }

      const pendingDeact = await getOne(
        `SELECT * FROM deactivation_requests WHERE drum_id = ? AND approved = 0`,
        [drum_id]
      );
      if (pendingDeact) {
        const e = new Error('该鼓具已有待审批的停用申请');
        e.statusCode = 400;
        throw e;
      }

      if (drum.current_status === '已领出') {
        const activeUsage = await getOne(
          `SELECT * FROM usage_records WHERE drum_id = ? AND return_time IS NULL`,
          [drum_id]
        );
        if (activeUsage) {
          const e = new Error('该鼓具当前已借出，请先归还后再申请停用');
          e.statusCode = 400;
          throw e;
        }
      }

      if (drum.current_status === '维护中') {
        const openMaint = await getOne(
          `SELECT * FROM maintenance_records WHERE drum_id = ? AND end_time IS NULL`,
          [drum_id]
        );
        if (openMaint) {
          const e = new Error('该鼓具正在维护中，请等维护完成后再申请停用');
          e.statusCode = 400;
          throw e;
        }
      }

      const now = nowIso();
      const insertRes = await runQuery(
        `INSERT INTO deactivation_requests (drum_id, staff_name, reason, created_at) VALUES (?, ?, ?, ?)`,
        [drum_id, staff_name.trim(), reason.trim(), now]
      );

      await runQuery(
        `UPDATE drums SET current_status = '停用申请中', updated_at = ? WHERE id = ?`,
        [now, drum_id]
      );

      return { request_id: insertRes.id };
    });

    res.json({
      message: '停用申请已提交，等待审批',
      request_id: result.request_id
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/deactivate/:id/approve', async (req, res) => {
  try {
    const reqId = parseInt(req.params.id, 10);
    if (!isPosInt(reqId)) {
      return res.status(400).json({ error: '参数错误: 无效的申请ID' });
    }
    const { approved_by, approval_notes } = req.body;

    if (!isNonEmptyStr(approved_by)) {
      return res.status(400).json({ error: '参数错误: approved_by 不能为空' });
    }

    await withTransaction(async () => {
      const request = await getOne('SELECT * FROM deactivation_requests WHERE id = ?', [reqId]);
      if (!request) {
        const e = new Error('申请不存在');
        e.statusCode = 404;
        throw e;
      }

      if (request.approved !== 0) {
        const e = new Error('该申请已审批，不可重复操作');
        e.statusCode = 400;
        throw e;
      }

      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [request.drum_id]);
      if (!drum) {
        const e = new Error('关联鼓具不存在');
        e.statusCode = 404;
        throw e;
      }

      const activeUsage = await getOne(
        `SELECT * FROM usage_records WHERE drum_id = ? AND return_time IS NULL`,
        [request.drum_id]
      );
      if (activeUsage) {
        const e = new Error('该鼓具当前已借出，无法批准停用，请先督促归还');
        e.statusCode = 400;
        throw e;
      }

      if (drum.current_status === '停用中') {
        const e = new Error('该鼓具已处于停用状态');
        e.statusCode = 400;
        throw e;
      }

      const openMaint = await getOne(
        `SELECT * FROM maintenance_records WHERE drum_id = ? AND end_time IS NULL`,
        [request.drum_id]
      );
      if (openMaint) {
        const e = new Error('该鼓具有未完成的维修记录，请先完成维修后再停用');
        e.statusCode = 400;
        throw e;
      }

      const now = nowIso();
      await runQuery(
        `UPDATE deactivation_requests SET approved = 1, approved_by = ?, approved_at = ? WHERE id = ?`,
        [approved_by.trim(), now, reqId]
      );

      await runQuery(
        `UPDATE drums SET current_status = '停用中', updated_at = ? WHERE id = ?`,
        [now, request.drum_id]
      );
    });

    res.json({ message: '停用申请已批准，鼓具已停用' });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/deactivate/:id/reject', async (req, res) => {
  try {
    const reqId = parseInt(req.params.id, 10);
    if (!isPosInt(reqId)) {
      return res.status(400).json({ error: '参数错误: 无效的申请ID' });
    }
    const { approved_by, approval_notes } = req.body;

    if (!isNonEmptyStr(approved_by)) {
      return res.status(400).json({ error: '参数错误: approved_by 不能为空' });
    }

    await withTransaction(async () => {
      const request = await getOne('SELECT * FROM deactivation_requests WHERE id = ?', [reqId]);
      if (!request) {
        const e = new Error('申请不存在');
        e.statusCode = 404;
        throw e;
      }
      if (request.approved !== 0) {
        const e = new Error('该申请已审批，不可重复操作');
        e.statusCode = 400;
        throw e;
      }

      const now = nowIso();
      await runQuery(
        `UPDATE deactivation_requests SET approved = 2, approved_by = ?, approved_at = ? WHERE id = ?`,
        [approved_by.trim(), now, reqId]
      );

      await runQuery(
        `UPDATE drums SET current_status = '待领出', updated_at = ? WHERE id = ?`,
        [now, request.drum_id]
      );
    });

    res.json({ message: '停用申请已拒绝' });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/reactivate', async (req, res) => {
  try {
    const { drum_id, staff_name } = req.body;

    if (!isPosInt(drum_id)) {
      return res.status(400).json({ error: '参数错误: drum_id 必须为正整数' });
    }
    if (!isNonEmptyStr(staff_name)) {
      return res.status(400).json({ error: '参数错误: staff_name 不能为空' });
    }

    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drum_id]);
      if (!drum) {
        const e = new Error('鼓具不存在');
        e.statusCode = 404;
        throw e;
      }

      if (drum.current_status !== '停用中') {
        const e = new Error(`当前状态为"${drum.current_status}"，不可恢复`);
        e.statusCode = 400;
        throw e;
      }

      const now = nowIso();
      await runQuery(
        `UPDATE drums SET current_status = '恢复可用', updated_at = ? WHERE id = ?`,
        [now, drum_id]
      );

      await runQuery(
        `INSERT INTO inspection_records 
         (drum_id, staff_name, tension, wear_level, notes, created_at)
         VALUES (?, ?, ?, ?, '停用恢复，建议进行全面检查', ?)`,
        [drum_id, staff_name.trim(), drum.tension, drum.wear_level, now]
      );

      return await getOne(`${DRUM_JOIN} WHERE d.id = ?`, [drum_id]);
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

    if (!isPosInt(drum_id)) {
      return res.status(400).json({ error: '参数错误: drum_id 必须为正整数' });
    }
    if (!isNonEmptyStr(staff_name)) {
      return res.status(400).json({ error: '参数错误: staff_name 不能为空' });
    }
    if (!isNonEmptyStr(reason)) {
      return res.status(400).json({ error: '参数错误: reason 不能为空' });
    }

    const hours = Number(extension_hours);
    if (!Number.isInteger(hours) || hours <= 0 || hours > 24 * 30) {
      return res.status(400).json({ error: '参数错误: extension_hours 必须为正整数（不超过720小时）' });
    }

    const result = await withTransaction(async () => {
      const drum = await getOne('SELECT * FROM drums WHERE id = ?', [drum_id]);
      if (!drum) {
        const e = new Error('鼓具不存在');
        e.statusCode = 404;
        throw e;
      }

      if (drum.current_status !== '已领出') {
        const e = new Error(`当前状态为"${drum.current_status}"，不可申请延期`);
        e.statusCode = 400;
        throw e;
      }

      const usageRecord = await getOne(
        `SELECT * FROM usage_records WHERE drum_id = ? AND return_time IS NULL ORDER BY checkout_time DESC LIMIT 1`,
        [drum_id]
      );
      if (!usageRecord) {
        const e = new Error('未找到对应的领出记录');
        e.statusCode = 400;
        throw e;
      }

      if (usageRecord.staff_name !== staff_name.trim()) {
        const e = new Error('只有领用人本人才能申请延期');
        e.statusCode = 403;
        e.details = {
          borrower: usageRecord.staff_name,
          applicant: staff_name.trim()
        };
        throw e;
      }

      const pendingExtension = await getOne(
        `SELECT * FROM extension_requests WHERE usage_record_id = ? AND approval_status = 'pending'`,
        [usageRecord.id]
      );
      if (pendingExtension) {
        const e = new Error('该借用已有待审批的延期申请，请等待审批');
        e.statusCode = 400;
        throw e;
      }

      const latestApproved = await getOne(
        `SELECT new_expected_return_time FROM extension_requests 
         WHERE usage_record_id = ? AND approval_status = 'approved' 
         ORDER BY created_at DESC LIMIT 1`,
        [usageRecord.id]
      );

      const baseExpectedReturn = latestApproved
        ? latestApproved.new_expected_return_time
        : usageRecord.expected_return_time;

      if (!baseExpectedReturn) {
        const e = new Error('借用记录缺少预计归还时间，无法延期');
        e.statusCode = 400;
        throw e;
      }

      const baseTime = new Date(baseExpectedReturn);
      if (isNaN(baseTime.getTime())) {
        const e = new Error('预计归还时间格式异常，无法延期');
        e.statusCode = 400;
        throw e;
      }

      const newExpectedReturn = new Date(baseTime.getTime() + hours * 60 * 60 * 1000).toISOString();
      const now = nowIso();

      const insertRes = await runQuery(
        `INSERT INTO extension_requests
         (usage_record_id, drum_id, staff_name, extension_hours, reason, original_expected_return_time, new_expected_return_time, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [usageRecord.id, drum_id, staff_name.trim(), hours, reason.trim(), baseExpectedReturn, newExpectedReturn, now]
      );

      return await getOne(`
        SELECT e.*, d.drum_number, d.name as drum_name, u.expected_return_time as current_expected_return_time
        FROM extension_requests e
        JOIN drums d ON e.drum_id = d.id
        JOIN usage_records u ON e.usage_record_id = u.id
        WHERE e.id = ?
      `, [insertRes.id]);
    });

    res.json({
      message: '延期申请已提交，等待审批',
      request_id: result.id,
      extension: result
    });
  } catch (err) {
    const status = err.statusCode || 400;
    const resp = { error: err.message };
    if (err.details) resp.details = err.details;
    res.status(status).json(resp);
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
      const id = parseInt(drum_id, 10);
      if (isPosInt(id)) {
        sql += ` AND e.drum_id = ?`;
        params.push(id);
      }
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
