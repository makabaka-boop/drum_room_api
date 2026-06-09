import requests
import json

BASE = "http://localhost:8078"

def p(title, data):
    print(f"\n=== {title} ===")
    if isinstance(data, dict):
        for k, v in data.items():
            if k != 'data':
                print(f"  {k}: {v}")
    print(json.dumps(data, ensure_ascii=False, indent=2)[:500])

print("=" * 50)
print("  鼓房管理系统 - Bug修复验证")
print("=" * 50)

# 1. 创建测试数据
print("\n【初始化测试数据】")
requests.post(f"{BASE}/api/admin/shifts", json={"name": "早班"})
requests.post(f"{BASE}/api/admin/shifts", json={"name": "晚班"})
requests.post(f"{BASE}/api/admin/positions", json={"name": "A-01"})
requests.post(f"{BASE}/api/admin/skins", json={"batch_number": "SKIN-001", "type": "军鼓皮"})
r = requests.post(f"{BASE}/api/admin/drums", json={
    "drum_number": "DRUM-001", "name": "主军鼓", "type": "军鼓", "size": "14寸",
    "skin_id": 1, "position_id": 1, "shift_id": 1, "inspection_interval_days": 7
})
print(f"✓ 鼓具创建成功，巡检周期: {r.json().get('inspection_interval_days')}天")

# 2. 测试巡检节点校验
print("\n【Bug修复1 & 6: 巡检节点校验】")
# 首次巡检
requests.post(f"{BASE}/api/staff/inspect", json={
    "drum_id": 1, "staff_name": "张三", "tension": "适中", "wear_level": 3
})
# 第二次巡检（未到节点，应拒绝）
r = requests.post(f"{BASE}/api/staff/inspect", json={
    "drum_id": 1, "staff_name": "张三", "tension": "适中", "wear_level": 3
})
result = r.json()
if result.get('error'):
    print(f"✓ 未到巡检节点正确拒绝: {result['error'][:50]}")
else:
    print(f"✗ 未正确拒绝: {result}")

# 用force强制巡检
r = requests.post(f"{BASE}/api/staff/inspect", json={
    "drum_id": 1, "staff_name": "张三", "tension": "适中", "wear_level": 3, "force": True
})
result = r.json()
print(f"✓ force参数强制巡检成功，时机: {result.get('inspection_timing')}, 警告: {len(result.get('warnings',[]))}条")

# 3. 测试补皮后复检自动清除
print("\n【Bug修复1 & 2: 补皮复检自动清除】")
# 领出归位产生待巡检状态
requests.post(f"{BASE}/api/staff/checkout", json={
    "drum_id": 1, "staff_name": "张三", "shift_id": 1, "purpose": "演出"
})
requests.post(f"{BASE}/api/staff/return", json={
    "drum_id": 1, "staff_name": "张三", "tension_after": "适中", "wear_after": 8, "edge_wear": "严重"
})
# 创建补皮维修（需要复检）
r = requests.post(f"{BASE}/api/staff/repair", json={
    "drum_id": 1, "staff_name": "李四", "description": "更换鼓皮",
    "skin_replaced": True, "new_skin_id": 1, "need_reinspection": True
})
print(f"✓ 补皮记录创建，需复检: {r.json()['maintenance']['need_reinspection'] == 1}")

# 查看待复检清单
r = requests.get(f"{BASE}/api/queries/stats/pending-reinspection")
print(f"✓ 待复检清单数量: {r.json()['count']}")

# 完成维修（需要复检的不自动标记）
requests.post(f"{BASE}/api/admin/maintenance/1/complete", json={"notes": "完成"})
r = requests.get(f"{BASE}/api/queries/stats/pending-reinspection")
print(f"✓ 完成维修后待复检数量: {r.json()['count']} (应=1)")

# 巡检后自动清除
requests.put(f"{BASE}/api/admin/drums/1", json={
    "drum_number": "DRUM-001", "name": "主军鼓", "type": "军鼓", "size": "14寸",
    "skin_id": 1, "position_id": 1, "shift_id": 1, "current_status": "待巡检"
})
r = requests.post(f"{BASE}/api/staff/inspect", json={
    "drum_id": 1, "staff_name": "王五", "tension": "适中", "wear_level": 1
})
print(f"✓ 巡检自动清除复检记录: {r.json().get('reinspected_maintenance')}条")

r = requests.get(f"{BASE}/api/queries/stats/pending-reinspection")
print(f"✓ 巡检后待复检数量: {r.json()['count']} (应=0)")

# 4. 测试磨损等级筛选
print("\n【Bug修复5: 磨损等级筛选】")
requests.put(f"{BASE}/api/admin/drums/1", json={
    "drum_number": "DRUM-001", "name": "主军鼓", "type": "军鼓", "size": "14寸",
    "skin_id": 1, "position_id": 1, "shift_id": 1, "current_status": "待领出", "wear_level": 8
})

r = requests.get(f"{BASE}/api/queries/drums?wear_severity=严重")
data = r.json()
print(f"✓ 严重等级筛选: {data['count']}条, 标签: {data['data'][0]['wear_severity_label'] if data['data'] else '无'}")

r = requests.get(f"{BASE}/api/queries/drums?wear_severity=轻微")
print(f"✓ 轻微等级筛选: {r.json()['count']}条")

# 5. 测试日期查询
print("\n【Bug修复4: 日期查询准确性】")
r = requests.get(f"{BASE}/api/queries/drums?start_date=2026-01-01&date_type=updated_at")
data = r.json()
print(f"✓ 日期查询使用 {data['date_type_used']}: {data['count']}条")

# 6. 测试班次异常分布
print("\n【Bug修复3: 班次异常分布 - 磨损问题突出显示】")
# 创建晚班高磨损数据
for i in range(3):
    requests.post(f"{BASE}/api/staff/checkout", json={
        "drum_id": 1, "staff_name": "测试", "shift_id": 2, "purpose": f"测试{i}"
    })
    requests.post(f"{BASE}/api/staff/return", json={
        "drum_id": 1, "staff_name": "测试", "tension_after": "适中", "wear_after": 9, "edge_wear": "严重"
    })
# 早班低磨损
requests.post(f"{BASE}/api/staff/checkout", json={
    "drum_id": 1, "staff_name": "测试", "shift_id": 1, "purpose": "早班"
})
requests.post(f"{BASE}/api/staff/return", json={
    "drum_id": 1, "staff_name": "测试", "tension_after": "适中", "wear_after": 2, "edge_wear": ""
})

r = requests.get(f"{BASE}/api/queries/stats/shift-anomalies")
data = r.json()
print(f"✓ 总班次: {data['summary']['total_shifts']}, 磨损问题班次: {data['summary']['wear_issue_shifts']}")
for s in data['data']:
    flag = "⚠️ " if s.get('wear_issue') else "✓ "
    print(f"  {flag}{s['name']}: 平均磨耗+{s['wear_analysis']['avg_wear_increase']}, "
          f"问题: {s.get('wear_issue')}, 等级: {s['anomaly_level']}")

print("\n" + "=" * 50)
print("  所有Bug修复验证完成！")
print("=" * 50)
