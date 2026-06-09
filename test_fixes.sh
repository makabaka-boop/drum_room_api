#!/bin/bash

BASE_URL="http://localhost:8078"

echo "============================================"
echo "  鼓房管理系统 - Bug修复测试脚本"
echo "============================================"

echo ""
echo "=== 步骤1: 创建基础数据 ==="
curl -s -X POST $BASE_URL/api/admin/shifts -H "Content-Type: application/json" \
  -d '{"name":"早班","description":"上午8-12点"}' | python3 -m json.tool
curl -s -X POST $BASE_URL/api/admin/shifts -H "Content-Type: application/json" \
  -d '{"name":"晚班","description":"下午4-8点"}' | python3 -m json.tool
curl -s -X POST $BASE_URL/api/admin/positions -H "Content-Type: application/json" \
  -d '{"name":"A-01","description":"A区第一排"}' | python3 -m json.tool
curl -s -X POST $BASE_URL/api/admin/skins -H "Content-Type: application/json" \
  -d '{"batch_number":"SKIN-2024-001","type":"军鼓皮","brand":"Remo"}' | python3 -m json.tool
curl -s -X POST $BASE_URL/api/admin/drums -H "Content-Type: application/json" \
  -d '{"drum_number":"DRUM-001","name":"主军鼓","type":"军鼓","size":"14寸","skin_id":1,"position_id":1,"shift_id":1,"inspection_interval_days":7}' | python3 -m json.tool

echo ""
echo "=== 步骤2: 测试巡检节点校验（未到节点应该被拒绝） ==="
curl -s -X POST $BASE_URL/api/staff/inspect -H "Content-Type: application/json" \
  -d '{"drum_id":1,"staff_name":"张三","tension":"适中","wear_level":3}' | python3 -m json.tool

echo ""
echo "=== 步骤3: 使用force参数强制巡检 ==="
curl -s -X POST $BASE_URL/api/staff/inspect -H "Content-Type: application/json" \
  -d '{"drum_id":1,"staff_name":"张三","tension":"适中","wear_level":3,"force":true}' | python3 -m json.tool

echo ""
echo "=== 步骤4: 领出并归位鼓具 ==="
curl -s -X POST $BASE_URL/api/staff/checkout -H "Content-Type: application/json" \
  -d '{"drum_id":1,"staff_name":"张三","shift_id":1,"purpose":"演出"}' | python3 -m json.tool
curl -s -X POST $BASE_URL/api/staff/return -H "Content-Type: application/json" \
  -d '{"drum_id":1,"staff_name":"张三","tension_after":"偏紧","wear_after":8,"edge_wear":"严重","notes":"演出使用"}' | python3 -m json.tool

echo ""
echo "=== 步骤5: 创建补皮维修记录（需要复检） ==="
curl -s -X POST $BASE_URL/api/staff/repair -H "Content-Type: application/json" \
  -d '{"drum_id":1,"staff_name":"李四","description":"边缘磨损严重，更换鼓皮","skin_replaced":true,"new_skin_id":1,"need_reinspection":true}' | python3 -m json.tool

echo ""
echo "=== 步骤6: 查看待复检清单（应该有1条） ==="
curl -s $BASE_URL/api/queries/stats/pending-reinspection | python3 -m json.tool

echo ""
echo "=== 步骤7: 查看补皮后未复检清单（应该有1条） ==="
curl -s $BASE_URL/api/queries/stats/unrepaired-after-patch | python3 -m json.tool

echo ""
echo "=== 步骤8: 完成维修（需要复检的不自动标记） ==="
curl -s -X POST $BASE_URL/api/admin/maintenance/1/complete -H "Content-Type: application/json" \
  -d '{"notes":"更换鼓皮完成"}' | python3 -m json.tool

echo ""
echo "=== 步骤9: 巡检（应该自动清除复检标记） ==="
curl -s -X POST $BASE_URL/api/staff/inspect -H "Content-Type: application/json" \
  -d '{"drum_id":1,"staff_name":"王五","tension":"适中","wear_level":1}' | python3 -m json.tool

echo ""
echo "=== 步骤10: 再次查看待复检清单（应该为0） ==="
curl -s $BASE_URL/api/queries/stats/pending-reinspection | python3 -m json.tool

echo ""
echo "=== 步骤11: 测试按磨损等级筛选 ==="
curl -s "$BASE_URL/api/queries/drums?wear_severity=严重" | python3 -m json.tool

echo ""
echo "=== 步骤12: 测试按日期查询（使用updated_at） ==="
curl -s "$BASE_URL/api/queries/drums?start_date=2026-01-01&date_type=updated_at" | python3 -m json.tool

echo ""
echo "=== 步骤13: 创建多班次使用数据用于测试班次异常分布 ==="
for i in 1 2 3; do
  curl -s -X POST $BASE_URL/api/staff/checkout -H "Content-Type: application/json" \
    -d "{\"drum_id\":1,\"staff_name\":\"测试员\",\"shift_id\":2,\"purpose\":\"测试$i\"}" > /dev/null
  curl -s -X POST $BASE_URL/api/staff/return -H "Content-Type: application/json" \
    -d "{\"drum_id\":1,\"staff_name\":\"测试员\",\"tension_after\":\"适中\",\"wear_after\":9,\"edge_wear\":\"严重\"}" > /dev/null
done

echo ""
echo "=== 步骤14: 查看班次异常分布（应该显示晚班磨损问题突出） ==="
curl -s $BASE_URL/api/queries/stats/shift-anomalies | python3 -m json.tool

echo ""
echo "============================================"
echo "  测试完成！"
echo "============================================"
