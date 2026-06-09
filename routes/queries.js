const express = require('express');
const router = express.Router();
const { 
  getQuery, 
  getOne,
  getCurrentTimeISO
} = require('../database');

router.get('/drums', async (req, res) => {
  try {
    const { 
      drum_number, shift_id, current_status, 
      min_wear, max_wear, wear_severity,
      start_date, end_date, date_type = 'updated_at'
    } = req.query;
    
    let sql = `
      SELECT DISTINCT d.*, 
             s.batch_number as skin_batch,
             p.name as position_name,
             sh.name as shift_name,
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
    `;
    
    let joinUsage = false;
    if (date_type === 'usage') {
      joinUsage = true;
      sql += ` LEFT JOIN usage_records u ON d.id = u.drum_id `;
    }
    
    sql += ` WHERE 1=1 `;
    let params = [];
    
    if (drum_number) {
      sql += ` AND d.drum_number LIKE ?`;
      params.push(`%${drum_number}%`);
    }
    
    if (shift_id) {
      sql += ` AND d.shift_id = ?`;
      params.push(shift_id);
    }
    
    if (current_status) {
      sql += ` AND d.current_status = ?`;
      params.push(current_status);
    }
    
    if (wear_severity) {
      if (wear_severity === 'mild' || wear_severity === '轻微') {
        sql += ` AND d.wear_level BETWEEN 0 AND 3`;
      } else if (wear_severity === 'moderate' || wear_severity === '中度') {
        sql += ` AND d.wear_level BETWEEN 4 AND 6`;
      } else if (wear_severity === 'severe' || wear_severity === '严重') {
        sql += ` AND d.wear_level >= 7`;
      }
    }
    
    if (min_wear !== undefined) {
      sql += ` AND d.wear_level >= ?`;
      params.push(Number(min_wear));
    }
    
    if (max_wear !== undefined) {
      sql += ` AND d.wear_level <= ?`;
      params.push(Number(max_wear));
    }
    
    if (start_date) {
      if (date_type === 'usage' && joinUsage) {
        sql += ` AND u.checkout_time >= ?`;
      } else if (date_type === 'created_at') {
        sql += ` AND d.created_at >= ?`;
      } else {
        sql += ` AND d.updated_at >= ?`;
      }
      params.push(start_date);
    }
    
    if (end_date) {
      if (date_type === 'usage' && joinUsage) {
        sql += ` AND u.checkout_time <= ?`;
      } else if (date_type === 'created_at') {
        sql += ` AND d.created_at <= ?`;
      } else {
        sql += ` AND d.updated_at <= ?`;
      }
      params.push(end_date);
    }
    
    sql += ` ORDER BY d.updated_at DESC, d.id DESC`;
    
    const drums = await getQuery(sql, params);
    
    const enrichedDrums = drums.map(drum => {
      let nextInspectionDate = null;
      if (drum.last_inspection_date) {
        const lastInspect = new Date(drum.last_inspection_date);
        const intervalDays = drum.inspection_interval_days || 7;
        nextInspectionDate = new Date(lastInspect.getTime() + intervalDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      } else {
        const now = new Date();
        const intervalDays = drum.inspection_interval_days || 7;
        nextInspectionDate = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      }
      
      return {
        ...drum,
        next_inspection_date: nextInspectionDate
      };
    });
    
    res.json({
      count: enrichedDrums.length,
      date_type_used: date_type,
      wear_severity_legend: {
        'mild/轻微': '0-3',
        'moderate/中度': '4-6',
        'severe/严重': '7-10'
      },
      data: enrichedDrums
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/usage-records', async (req, res) => {
  try {
    const { drum_id, shift_id, staff_name, start_date, end_date, is_overdue } = req.query;
    
    let sql = `
      SELECT u.*, d.drum_number, d.name as drum_name, sh.name as shift_name
      FROM usage_records u
      JOIN drums d ON u.drum_id = d.id
      LEFT JOIN shifts sh ON u.shift_id = sh.id
      WHERE 1=1
    `;
    let params = [];
    
    if (drum_id) {
      sql += ` AND u.drum_id = ?`;
      params.push(drum_id);
    }
    
    if (shift_id) {
      sql += ` AND u.shift_id = ?`;
      params.push(shift_id);
    }
    
    if (staff_name) {
      sql += ` AND u.staff_name LIKE ?`;
      params.push(`%${staff_name}%`);
    }
    
    if (start_date) {
      sql += ` AND u.checkout_time >= ?`;
      params.push(start_date);
    }
    
    if (end_date) {
      sql += ` AND u.checkout_time <= ?`;
      params.push(end_date);
    }
    
    if (is_overdue !== undefined) {
      sql += ` AND u.is_overdue = ?`;
      params.push(is_overdue === 'true' || is_overdue === '1' ? 1 : 0);
    }
    
    sql += ` ORDER BY u.checkout_time DESC LIMIT 200`;
    
    const records = await getQuery(sql, params);
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/inspection-records', async (req, res) => {
  try {
    const { drum_id, shift_id, staff_name, start_date, end_date, needs_repair } = req.query;
    
    let sql = `
      SELECT i.*, d.drum_number, d.name as drum_name, sh.name as shift_name
      FROM inspection_records i
      JOIN drums d ON i.drum_id = d.id
      LEFT JOIN shifts sh ON i.shift_id = sh.id
      WHERE 1=1
    `;
    let params = [];
    
    if (drum_id) {
      sql += ` AND i.drum_id = ?`;
      params.push(drum_id);
    }
    
    if (shift_id) {
      sql += ` AND i.shift_id = ?`;
      params.push(shift_id);
    }
    
    if (staff_name) {
      sql += ` AND i.staff_name LIKE ?`;
      params.push(`%${staff_name}%`);
    }
    
    if (start_date) {
      sql += ` AND i.created_at >= ?`;
      params.push(start_date);
    }
    
    if (end_date) {
      sql += ` AND i.created_at <= ?`;
      params.push(end_date);
    }
    
    if (needs_repair !== undefined) {
      sql += ` AND i.needs_repair = ?`;
      params.push(needs_repair === 'true' || needs_repair === '1' ? 1 : 0);
    }
    
    sql += ` ORDER BY i.created_at DESC LIMIT 200`;
    
    const records = await getQuery(sql, params);
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats/high-wear-drums', async (req, res) => {
  try {
    const { limit = 20, min_uses = 5 } = req.query;
    
    const drums = await getQuery(`
      SELECT 
        d.id,
        d.drum_number,
        d.name,
        d.wear_level,
        d.total_uses,
        s.batch_number as skin_batch,
        sh.name as shift_name,
        d.current_status,
        CASE WHEN d.total_uses > 0 THEN ROUND(d.wear_level * 10.0 / d.total_uses, 2) ELSE 0 END as wear_per_use
      FROM drums d
      LEFT JOIN drum_skins s ON d.skin_id = s.id
      LEFT JOIN shifts sh ON d.shift_id = sh.id
      WHERE d.total_uses >= ?
      ORDER BY wear_per_use DESC, d.wear_level DESC
      LIMIT ?
    `, [Number(min_uses), Number(limit)]);
    
    res.json({
      title: '高损耗鼓具排行',
      description: '按每次使用磨耗率排序',
      data: drums
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats/pending-reinspection', async (req, res) => {
  try {
    const records = await getQuery(`
      SELECT 
        m.id as maintenance_id,
        d.id as drum_id,
        d.drum_number,
        d.name as drum_name,
        m.staff_name,
        m.type,
        m.description,
        m.created_at as maintenance_date,
        m.need_reinspection,
        m.reinspected,
        m.end_time as maintenance_completed_date,
        d.current_status,
        CASE 
          WHEN m.end_time IS NOT NULL THEN '维修已完成，待复检'
          ELSE '维修进行中'
        END as status_note
      FROM maintenance_records m
      JOIN drums d ON m.drum_id = d.id
      WHERE m.need_reinspection = 1 
        AND m.reinspected = 0
      ORDER BY m.created_at DESC
    `);
    
    res.json({
      title: '待复检清单',
      description: '补皮或维修后需要复检的鼓具',
      count: records.length,
      data: records
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats/shift-anomalies', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const dateLimit = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    
    const shiftStats = await getQuery(`
      SELECT 
        sh.id,
        sh.name,
        COUNT(DISTINCT u.id) as total_uses,
        SUM(CASE WHEN u.is_overdue = 1 THEN 1 ELSE 0 END) as overdue_count,
        COUNT(DISTINCT i.id) as inspection_count,
        SUM(CASE WHEN i.needs_repair = 1 THEN 1 ELSE 0 END) as repair_count,
        COUNT(DISTINCT m.id) as maintenance_count,
        AVG(CASE WHEN u.wear_after IS NOT NULL AND u.wear_before IS NOT NULL 
                 THEN u.wear_after - u.wear_before ELSE NULL END) as avg_wear_increase,
        SUM(CASE WHEN u.wear_after >= 7 THEN 1 ELSE 0 END) as high_wear_count,
        MAX(u.wear_after) as max_wear_level,
        SUM(CASE WHEN u.edge_wear IS NOT NULL AND u.edge_wear != '' THEN 1 ELSE 0 END) as edge_wear_count
      FROM shifts sh
      LEFT JOIN usage_records u ON sh.id = u.shift_id AND u.created_at >= ?
      LEFT JOIN inspection_records i ON sh.id = i.shift_id AND i.created_at >= ?
      LEFT JOIN maintenance_records m ON sh.id = (SELECT shift_id FROM drums WHERE id = m.drum_id) AND m.created_at >= ?
      GROUP BY sh.id, sh.name
      ORDER BY repair_count DESC, avg_wear_increase DESC, overdue_count DESC
    `, [dateLimit, dateLimit, dateLimit]);
    
    const overallStats = await getQuery(`
      SELECT 
        COUNT(*) as total_records,
        SUM(CASE WHEN is_overdue = 1 THEN 1 ELSE 0 END) as total_overdue,
        AVG(CASE WHEN wear_after IS NOT NULL AND wear_before IS NOT NULL 
                 THEN wear_after - wear_before ELSE NULL END) as overall_avg_wear_increase
      FROM usage_records
      WHERE created_at >= ?
    `, [dateLimit]);
    
    const avgWearIncrease = overallStats[0].overall_avg_wear_increase || 0;
    
    const anomalies = shiftStats.map(shift => {
      const avgUsePerShift = overallStats[0].total_records / (shiftStats.length || 1);
      const avgOverdueRate = overallStats[0].total_records > 0 
        ? overallStats[0].total_overdue / overallStats[0].total_records 
        : 0;
      
      const shiftOverdueRate = shift.total_uses > 0 ? shift.overdue_count / shift.total_uses : 0;
      const shiftAvgWearIncrease = shift.avg_wear_increase || 0;
      const highWearRate = shift.total_uses > 0 ? shift.high_wear_count / shift.total_uses : 0;
      const edgeWearRate = shift.total_uses > 0 ? shift.edge_wear_count / shift.total_uses : 0;
      
      const isHighWear = shiftAvgWearIncrease > avgWearIncrease * 1.2 && shift.total_uses >= 1;
      const isHighEdgeWear = edgeWearRate > 0.2 && shift.edge_wear_count >= 1;
      
      const wearAnomalyScore = (shiftAvgWearIncrease / Math.max(avgWearIncrease, 0.1)) * 30 +
                               (highWearRate * 30) +
                               (isHighEdgeWear ? 20 : 0);
      
      const anomalyScore = Math.round(
        (shiftOverdueRate * 25) + 
        (shift.repair_count / Math.max(shift.total_uses, 1)) * 25 +
        wearAnomalyScore
      );
      
      let anomalyLevel = 'normal';
      let wearIssue = null;
      if (isHighWear && isHighEdgeWear) {
        wearIssue = '严重磨损问题班次';
        anomalyLevel = 'critical';
      } else if (isHighWear || shift.high_wear_count >= 3) {
        wearIssue = '高磨损班次';
        anomalyLevel = 'warning';
      } else if (isHighEdgeWear) {
        wearIssue = '边缘磨损突出班次';
        anomalyLevel = 'warning';
      }
      
      return {
        ...shift,
        overdue_rate: Math.round(shiftOverdueRate * 100) / 100,
        repair_rate: shift.total_uses > 0 ? Math.round((shift.repair_count / shift.total_uses) * 100) / 100 : 0,
        avg_wear_increase: Math.round(shiftAvgWearIncrease * 100) / 100,
        high_wear_rate: Math.round(highWearRate * 100) / 100,
        edge_wear_rate: Math.round(edgeWearRate * 100) / 100,
        is_high_overdue: shiftOverdueRate > avgOverdueRate * 1.5 && shift.overdue_count > 2,
        is_high_repair: shift.repair_count > 2,
        is_high_wear: isHighWear,
        is_high_edge_wear: isHighEdgeWear,
        wear_issue: wearIssue,
        anomaly_level: anomalyLevel,
        anomaly_score: anomalyScore,
        wear_analysis: {
          avg_wear_increase: Math.round(shiftAvgWearIncrease * 100) / 100,
          compared_to_overall: avgWearIncrease > 0 
            ? Math.round((shiftAvgWearIncrease / avgWearIncrease) * 100) + '%' 
            : 'N/A',
          high_wear_count: shift.high_wear_count,
          edge_wear_count: shift.edge_wear_count,
          max_wear_level: shift.max_wear_level
        }
      };
    });
    
    anomalies.sort((a, b) => b.anomaly_score - a.anomaly_score);
    
    res.json({
      title: '班次异常分布',
      description: `最近${days}天各班次的异常情况统计（含磨损分析）`,
      time_range: {
        start: dateLimit,
        end: getCurrentTimeISO()
      },
      overall: {
        total_uses: overallStats[0].total_records,
        total_overdue: overallStats[0].total_overdue,
        avg_overdue_rate: Math.round((overallStats[0].total_overdue / Math.max(overallStats[0].total_records, 1)) * 10000) / 100,
        avg_wear_increase_per_use: Math.round(avgWearIncrease * 100) / 100
      },
      wear_legend: {
        wear_levels: '0-3: 轻微, 4-6: 中度, 7-10: 严重',
        critical_threshold: '平均磨耗增幅 > 整体平均值130% 且 使用次数 >= 3'
      },
      summary: {
        total_shifts: anomalies.length,
        critical_shifts: anomalies.filter(a => a.anomaly_level === 'critical').length,
        warning_shifts: anomalies.filter(a => a.anomaly_level === 'warning').length,
        wear_issue_shifts: anomalies.filter(a => a.wear_issue !== null).length
      },
      data: anomalies
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats/frequent-wear', async (req, res) => {
  try {
    const { days = 14, threshold = 3 } = req.query;
    const dateLimit = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    
    const frequentWear = await getQuery(`
      SELECT 
        d.id as drum_id,
        d.drum_number,
        d.name,
        d.wear_level,
        COUNT(m.id) as maintenance_count,
        GROUP_CONCAT(m.type, ', ') as maintenance_types,
        MIN(m.created_at) as first_maintenance,
        MAX(m.created_at) as last_maintenance
      FROM maintenance_records m
      JOIN drums d ON m.drum_id = d.id
      WHERE m.created_at >= ?
      GROUP BY d.id, d.drum_number, d.name, d.wear_level
      HAVING maintenance_count >= ?
      ORDER BY maintenance_count DESC
    `, [dateLimit, Number(threshold)]);
    
    res.json({
      title: '高频磨耗预警',
      description: `在${days}天内维修/补皮超过${threshold}次的鼓具`,
      count: frequentWear.length,
      data: frequentWear
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats/overdue-returns', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const dateLimit = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    
    const overdueRecords = await getQuery(`
      SELECT 
        u.*,
        d.drum_number,
        d.name as drum_name,
        sh.name as shift_name
      FROM usage_records u
      JOIN drums d ON u.drum_id = d.id
      LEFT JOIN shifts sh ON u.shift_id = sh.id
      WHERE u.is_overdue = 1 AND u.return_time >= ?
      ORDER BY u.return_time DESC
    `, [dateLimit]);
    
    const enrichedRecords = overdueRecords.map(record => {
      let overdueHours = 0;
      if (record.expected_return_time && record.return_time) {
        const expected = new Date(record.expected_return_time);
        const returned = new Date(record.return_time);
        overdueHours = Math.round((returned - expected) / (1000 * 60 * 60) * 10) / 10;
      }
      return {
        ...record,
        overdue_hours: overdueHours
      };
    });
    
    const totalOverdueHours = enrichedRecords.reduce((sum, r) => sum + (r.overdue_hours || 0), 0);
    
    res.json({
      title: '归位超时记录',
      description: `最近${days}天的超时归还记录`,
      count: enrichedRecords.length,
      total_overdue_hours: Math.round(totalOverdueHours * 10) / 10,
      data: enrichedRecords
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats/unrepaired-after-patch', async (req, res) => {
  try {
    const records = await getQuery(`
      SELECT 
        m.id as maintenance_id,
        d.id as drum_id,
        d.drum_number,
        d.name as drum_name,
        m.staff_name,
        m.created_at as patch_date,
        m.description,
        d.current_status
      FROM maintenance_records m
      JOIN drums d ON m.drum_id = d.id
      WHERE m.skin_replaced = 1
        AND m.need_reinspection = 1
        AND m.reinspected = 0
      ORDER BY m.created_at ASC
    `);
    
    const enrichedRecords = await Promise.all(records.map(async (record) => {
      const inspectionCount = await getOne(`
        SELECT COUNT(*) as count 
        FROM inspection_records i 
        WHERE i.drum_id = ? AND i.created_at > ?
      `, [record.drum_id, record.patch_date]);
      
      return {
        ...record,
        inspections_after: inspectionCount.count
      };
    }));
    
    const filteredRecords = enrichedRecords.filter(r => r.inspections_after === 0);
    
    res.json({
      title: '补皮后未复检清单',
      description: '更换鼓皮后需要但尚未进行复检的鼓具',
      count: filteredRecords.length,
      data: filteredRecords
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status', async (req, res) => {
  try {
    const statusCounts = await getQuery(`
      SELECT current_status as status, COUNT(*) as count
      FROM drums
      GROUP BY current_status
      ORDER BY count DESC
    `);
    
    const totalDrums = await getOne('SELECT COUNT(*) as total FROM drums');
    const activeUsage = await getOne('SELECT COUNT(*) as active FROM usage_records WHERE return_time IS NULL');
    const pendingMaintenance = await getQuery(`
      SELECT COUNT(*) as pending 
      FROM maintenance_records 
      WHERE end_time IS NULL
    `);
    
    res.json({
      total_drums: totalDrums.total,
      active_in_use: activeUsage.active,
      pending_maintenance: pendingMaintenance.pending,
      status_distribution: statusCounts
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/borrowed-drums', async (req, res) => {
  try {
    const { shift_id, staff_name, is_overdue, start_date, end_date, extension_status } = req.query;

    let havingClause = '';
    let havingParams = [];

    if (extension_status) {
      if (extension_status === 'none') {
        havingClause = ` HAVING latest_extension_status IS NULL `;
      } else if (extension_status === 'pending') {
        havingClause = ` HAVING latest_extension_status = 'pending' `;
      } else if (extension_status === 'approved') {
        havingClause = ` HAVING latest_extension_status = 'approved' `;
      } else if (extension_status === 'rejected') {
        havingClause = ` HAVING latest_extension_status = 'rejected' `;
      }
    }

    let sql = `
      SELECT 
        u.id as usage_id,
        d.id as drum_id,
        d.drum_number,
        d.name as drum_name,
        d.type as drum_type,
        u.staff_name as borrower,
        u.purpose,
        u.checkout_time,
        u.expected_return_time,
        sh.id as shift_id,
        sh.name as shift_name,
        (
          SELECT e.id 
          FROM extension_requests e 
          WHERE e.usage_record_id = u.id 
            AND e.approval_status = 'pending'
          LIMIT 1
        ) as pending_extension_id,
        (
          SELECT e.extension_hours 
          FROM extension_requests e 
          WHERE e.usage_record_id = u.id 
            AND e.approval_status = 'pending'
          LIMIT 1
        ) as pending_extension_hours,
        (
          SELECT e.new_expected_return_time 
          FROM extension_requests e 
          WHERE e.usage_record_id = u.id 
            AND e.approval_status = 'approved'
          ORDER BY e.created_at DESC
          LIMIT 1
        ) as latest_approved_extension_time,
        (
          SELECT e.original_expected_return_time 
          FROM extension_requests e 
          WHERE e.usage_record_id = u.id 
          ORDER BY e.created_at ASC
          LIMIT 1
        ) as first_original_expected_return_time,
        (
          SELECT e.id 
          FROM extension_requests e 
          WHERE e.usage_record_id = u.id 
          ORDER BY e.created_at DESC
          LIMIT 1
        ) as latest_extension_id,
        (
          SELECT e.approval_status 
          FROM extension_requests e 
          WHERE e.usage_record_id = u.id 
          ORDER BY e.created_at DESC
          LIMIT 1
        ) as latest_extension_status,
        (
          SELECT e.reason 
          FROM extension_requests e 
          WHERE e.usage_record_id = u.id 
          ORDER BY e.created_at DESC
          LIMIT 1
        ) as latest_extension_reason,
        (
          SELECT e.approved_by 
          FROM extension_requests e 
          WHERE e.usage_record_id = u.id 
          ORDER BY e.created_at DESC
          LIMIT 1
        ) as latest_extension_approved_by,
        (
          SELECT e.approved_at 
          FROM extension_requests e 
          WHERE e.usage_record_id = u.id 
          ORDER BY e.created_at DESC
          LIMIT 1
        ) as latest_extension_approved_at,
        (
          SELECT e.extension_hours 
          FROM extension_requests e 
          WHERE e.usage_record_id = u.id 
          ORDER BY e.created_at DESC
          LIMIT 1
        ) as latest_extension_hours,
        (
          SELECT COUNT(*) 
          FROM extension_requests e 
          WHERE e.usage_record_id = u.id
        ) as extension_count
      FROM usage_records u
      JOIN drums d ON u.drum_id = d.id
      LEFT JOIN shifts sh ON u.shift_id = sh.id
      WHERE u.return_time IS NULL
    `;
    let params = [];

    if (shift_id) {
      sql += ` AND u.shift_id = ?`;
      params.push(shift_id);
    }

    if (staff_name) {
      sql += ` AND u.staff_name LIKE ?`;
      params.push(`%${staff_name}%`);
    }

    if (start_date) {
      sql += ` AND u.checkout_time >= ?`;
      params.push(start_date);
    }

    if (end_date) {
      sql += ` AND u.checkout_time <= ?`;
      params.push(end_date);
    }

    sql += ` GROUP BY u.id `;

    if (havingClause) {
      sql += havingClause;
      params = params.concat(havingParams);
    }

    sql += ` ORDER BY u.checkout_time DESC`;

    const records = await getQuery(sql, params);

    const now = new Date();
    
    const enrichedRecords = records.map(record => {
      const currentExpectedReturn = record.latest_approved_extension_time || record.expected_return_time;
      const originalExpectedReturn = record.first_original_expected_return_time || record.expected_return_time;

      const currentExpected = new Date(currentExpectedReturn);
      const actualIsOverdue = now > currentExpected;
      const actualOverdueHours = actualIsOverdue
        ? Math.round((now - currentExpected) / (1000 * 60 * 60) * 100) / 100
        : 0;

      let extensionStatusLabel = null;
      if (record.latest_extension_status) {
        switch (record.latest_extension_status) {
          case 'pending':
            extensionStatusLabel = '待审批';
            break;
          case 'approved':
            extensionStatusLabel = '已同意';
            break;
          case 'rejected':
            extensionStatusLabel = '已拒绝';
            break;
          default:
            extensionStatusLabel = record.latest_extension_status;
        }
      }

      return {
        ...record,
        original_expected_return_time: originalExpectedReturn,
        current_expected_return_time: currentExpectedReturn,
        is_overdue: actualIsOverdue ? 1 : 0,
        overdue_hours: actualOverdueHours,
        has_extension_history: record.first_original_expected_return_time !== null,
        latest_extension_status_label: extensionStatusLabel
      };
    });

    let filteredRecords = enrichedRecords;
    if (is_overdue !== undefined) {
      const wantOverdue = is_overdue === 'true' || is_overdue === '1';
      filteredRecords = enrichedRecords.filter(r => (r.is_overdue === 1) === wantOverdue);
    }

    res.json({
      title: '在借鼓具清单',
      description: '当前未归还的鼓具列表，含延期信息和超时状态',
      count: filteredRecords.length,
      overdue_count: filteredRecords.filter(r => r.is_overdue === 1).length,
      pending_extension_count: filteredRecords.filter(r => r.pending_extension_id !== null).length,
      extension_count: filteredRecords.filter(r => r.has_extension_history).length,
      filters: {
        shift_id: shift_id || null,
        staff_name: staff_name || null,
        is_overdue: is_overdue || null,
        extension_status: extension_status || null
      },
      extension_status_legend: {
        'none': '无延期申请',
        'pending': '待审批',
        'approved': '已同意',
        'rejected': '已拒绝'
      },
      data: filteredRecords
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/extension-records', async (req, res) => {
  try {
    const { shift_id, staff_name, approval_status, is_overdue, drum_id, start_date, end_date } = req.query;

    let sql = `
      SELECT 
        e.id as extension_id,
        e.usage_record_id,
        e.drum_id,
        d.drum_number,
        d.name as drum_name,
        d.type as drum_type,
        e.staff_name as applicant,
        u.staff_name as borrower,
        e.extension_hours,
        e.reason as extension_reason,
        e.original_expected_return_time,
        e.new_expected_return_time,
        e.approval_status,
        e.approved_by,
        e.approved_at,
        e.approval_notes,
        e.created_at as request_time,
        u.shift_id,
        sh.name as shift_name,
        u.checkout_time,
        u.return_time
      FROM extension_requests e
      JOIN drums d ON e.drum_id = d.id
      JOIN usage_records u ON e.usage_record_id = u.id
      LEFT JOIN shifts sh ON u.shift_id = sh.id
      WHERE 1=1
    `;
    let params = [];

    if (shift_id) {
      sql += ` AND u.shift_id = ?`;
      params.push(shift_id);
    }

    if (staff_name) {
      sql += ` AND (e.staff_name LIKE ? OR u.staff_name LIKE ?)`;
      params.push(`%${staff_name}%`, `%${staff_name}%`);
    }

    if (approval_status) {
      sql += ` AND e.approval_status = ?`;
      params.push(approval_status);
    }

    if (drum_id) {
      sql += ` AND e.drum_id = ?`;
      params.push(drum_id);
    }

    if (start_date) {
      sql += ` AND e.created_at >= ?`;
      params.push(start_date);
    }

    if (end_date) {
      sql += ` AND e.created_at <= ?`;
      params.push(end_date);
    }

    sql += ` ORDER BY e.created_at DESC LIMIT 200`;

    const records = await getQuery(sql, params);

    const now = new Date();

    const enrichedRecords = records.map(record => {
      let currentExpectedReturn;
      
      if (record.approval_status === 'approved' && record.new_expected_return_time) {
        currentExpectedReturn = record.new_expected_return_time;
      } else {
        currentExpectedReturn = record.original_expected_return_time;
      }

      const expectedDate = new Date(currentExpectedReturn);
      const actualIsOverdue = record.return_time ? false : now > expectedDate;
      const actualOverdueHours = actualIsOverdue && !record.return_time
        ? Math.round((now - expectedDate) / (1000 * 60 * 60) * 100) / 100
        : 0;

      let approvalStatusLabel;
      switch (record.approval_status) {
        case 'pending':
          approvalStatusLabel = '待审批';
          break;
        case 'approved':
          approvalStatusLabel = '已同意';
          break;
        case 'rejected':
          approvalStatusLabel = '已拒绝';
          break;
        default:
          approvalStatusLabel = record.approval_status;
      }

      return {
        ...record,
        is_overdue: actualIsOverdue ? 1 : 0,
        overdue_hours: actualOverdueHours,
        current_expected_return_time: currentExpectedReturn,
        approval_status_label: approvalStatusLabel
      };
    });

    let filteredRecords = enrichedRecords;
    if (is_overdue !== undefined) {
      const wantOverdue = is_overdue === 'true' || is_overdue === '1';
      filteredRecords = enrichedRecords.filter(r => (r.is_overdue === 1) === wantOverdue);
    }

    res.json({
      title: '延期申请记录',
      description: '所有借用延期申请记录，支持多维度筛选',
      count: filteredRecords.length,
      approved_count: filteredRecords.filter(r => r.approval_status === 'approved').length,
      rejected_count: filteredRecords.filter(r => r.approval_status === 'rejected').length,
      pending_count: filteredRecords.filter(r => r.approval_status === 'pending').length,
      overdue_count: filteredRecords.filter(r => r.is_overdue === 1).length,
      filters: {
        shift_id: shift_id || null,
        staff_name: staff_name || null,
        approval_status: approval_status || null,
        is_overdue: is_overdue || null,
        drum_id: drum_id || null
      },
      approval_status_legend: {
        'pending': '待审批',
        'approved': '已同意',
        'rejected': '已拒绝'
      },
      data: filteredRecords
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
