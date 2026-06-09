import requests
import json

BASE = "http://localhost:8078"

def p(title, data):
    print(f"\n=== {title} ===")
    if isinstance(data, dict):
        for k, v in data.items():
            if k != 'data':
                print(f"  {k}: {v}")
    print(json.dumps(data, ensure_ascii=False, indent=2)[:1000])

print("=" * 70)
print("  借用延期功能修复验证")
print("=" * 70)

print("\n【初始化测试数据】")
requests.post(f"{BASE}/api/admin/shifts", json={"name": "早班"})
requests.post(f"{BASE}/api/admin/positions", json={"name": "A-01"})
requests.post(f"{BASE}/api/admin/skins", json={"batch_number": "SKIN-FIX-001", "type": "军鼓皮"})
r = requests.post(f"{BASE}/api/admin/drums", json={
    "drum_number": "DRUM-FIX-001", "name": "修复测试鼓", "type": "军鼓", "size": "14寸",
    "skin_id": 1, "position_id": 1, "shift_id": 1, "inspection_interval_days": 7
})
print(f"✓ 鼓具创建成功: {r.json().get('drum_number')}")

print("\n" + "=" * 70)
print("  测试1: 领出鼓具")
print("=" * 70)

r = requests.post(f"{BASE}/api/staff/checkout", json={
    "drum_id": 1, "staff_name": "张三", "shift_id": 1, "purpose": "测试",
    "expected_return_hours": 4
})
print(f"✓ 张三领出鼓具成功")

print("\n" + "=" * 70)
print("  测试2: 修复验证 - 只有领用人本人才能申请延期")
print("=" * 70)

print("\n--- 测试2.1: 李四替张三申请延期（应拒绝） ---")
r = requests.post(f"{BASE}/api/staff/extension", json={
    "drum_id": 1,
    "staff_name": "李四",
    "extension_hours": 8,
    "reason": "李四替张三申请"
})
result = r.json()
p("替别人申请结果", result)
assert r.status_code == 403, f"应返回403，实际返回{r.status_code}"
assert '只有领用人本人才能申请延期' in result.get('error', ''), "错误信息不正确"
assert result['details']['borrower'] == '张三', "领用人信息不正确"
assert result['details']['applicant'] == '李四', "申请人信息不正确"
print("✓ 替别人申请延期正确拒绝，返回403")

print("\n--- 测试2.2: 张三本人申请延期（应成功） ---")
r = requests.post(f"{BASE}/api/staff/extension", json={
    "drum_id": 1,
    "staff_name": "张三",
    "extension_hours": 8,
    "reason": "第一次延期"
})
result = r.json()
assert r.status_code == 200, f"应返回200，实际返回{r.status_code}"
assert result.get('request_id') is not None, "申请失败"
print("✓ 本人申请延期成功")

print("\n" + "=" * 70)
print("  测试3: 修复验证 - 多次延期时原预计归还时间取最初值")
print("=" * 70)

print("\n--- 测试3.1: 批准第一次延期 ---")
r = requests.post(f"{BASE}/api/admin/extension/1/approve", json={
    "approved_by": "王管理员",
    "approval_notes": "同意第一次延期"
})
assert r.status_code == 200, "批准失败"
print("✓ 第一次延期批准成功")

print("\n--- 测试3.2: 查询在借清单，记录当前原预计归还时间 ---")
r = requests.get(f"{BASE}/api/queries/borrowed-drums")
result = r.json()
record = result['data'][0]
first_original = record['original_expected_return_time']
print(f"  第一次延期后的原预计归还时间: {first_original}")
print(f"  当前预计归还时间: {record['current_expected_return_time']}")
assert first_original != record['current_expected_return_time'], "应不同"

print("\n--- 测试3.3: 张三申请第二次延期 ---")
r = requests.post(f"{BASE}/api/staff/extension", json={
    "drum_id": 1,
    "staff_name": "张三",
    "extension_hours": 4,
    "reason": "第二次延期"
})
assert r.status_code == 200, "第二次申请失败"
print("✓ 第二次延期申请成功")

print("\n--- 测试3.4: 批准第二次延期 ---")
r = requests.post(f"{BASE}/api/admin/extension/2/approve", json={
    "approved_by": "王管理员",
    "approval_notes": "同意第二次延期"
})
assert r.status_code == 200, "第二次批准失败"
print("✓ 第二次延期批准成功")

print("\n--- 测试3.5: 验证原预计归还时间不变（取最初值） ---")
r = requests.get(f"{BASE}/api/queries/borrowed-drums")
result = r.json()
record = result['data'][0]
second_original = record['original_expected_return_time']
print(f"  第二次延期后的原预计归还时间: {second_original}")
print(f"  当前预计归还时间: {record['current_expected_return_time']}")
assert first_original == second_original, f"原预计归还时间应保持不变！第一次:{first_original}，第二次:{second_original}"
print("✓ 多次延期后原预计归还时间保持最初值正确")

print("\n" + "=" * 70)
print("  测试4: 修复验证 - 在借清单补充延期相关信息")
print("=" * 70)

r = requests.get(f"{BASE}/api/queries/borrowed-drums")
result = r.json()
record = result['data'][0]

print("\n--- 测试4.1: 检查新增字段 ---")
new_fields = [
    'latest_extension_status',
    'latest_extension_status_label',
    'latest_extension_reason',
    'latest_extension_approved_by',
    'latest_extension_approved_at',
    'latest_extension_hours',
    'extension_count'
]
for field in new_fields:
    assert field in record, f"缺少字段: {field}"
    print(f"  ✓ {field}: {record.get(field)}")

print("\n--- 测试4.2: 验证字段值正确性 ---")
assert record['latest_extension_status'] == 'approved', f"状态应为approved，实际{record['latest_extension_status']}"
assert record['latest_extension_status_label'] == '已同意', f"标签应为已同意，实际{record['latest_extension_status_label']}"
assert record['latest_extension_reason'] == '第二次延期', f"原因应为第二次延期，实际{record['latest_extension_reason']}"
assert record['latest_extension_approved_by'] == '王管理员', f"审批人应为王管理员，实际{record['latest_extension_approved_by']}"
assert record['latest_extension_hours'] == 4, f"延期时长应为4，实际{record['latest_extension_hours']}"
assert record['extension_count'] == 2, f"延期次数应为2，实际{record['extension_count']}"
print("✓ 所有新增字段值正确")

print("\n" + "=" * 70)
print("  测试5: 修复验证 - 按延期审批状态筛选")
print("=" * 70)

print("\n--- 准备测试数据：领出另一鼓具 ---")
r = requests.post(f"{BASE}/api/admin/drums", json={
    "drum_number": "DRUM-FIX-002", "name": "筛选测试鼓", "type": "嗵鼓", "size": "12寸",
    "skin_id": 1, "position_id": 1, "shift_id": 1, "inspection_interval_days": 7
})
requests.post(f"{BASE}/api/staff/checkout", json={
    "drum_id": 2, "staff_name": "王五", "shift_id": 1, "purpose": "测试筛选",
    "expected_return_hours": 4
})
print("✓ 第二鼓具领出成功，无延期申请")

print("\n--- 测试5.1: 筛选无延期申请（extension_status=none） ---")
r = requests.get(f"{BASE}/api/queries/borrowed-drums?extension_status=none")
result = r.json()
p("无延期筛选结果", result)
assert result['count'] == 1, f"无延期记录应为1条，实际{result['count']}"
assert result['data'][0]['drum_number'] == 'DRUM-FIX-002', "应是第二鼓具"
print("✓ 无延期筛选正确")

print("\n--- 测试5.2: 筛选已批准（extension_status=approved） ---")
r = requests.get(f"{BASE}/api/queries/borrowed-drums?extension_status=approved")
result = r.json()
assert result['count'] == 1, f"已批准记录应为1条，实际{result['count']}"
assert result['data'][0]['drum_number'] == 'DRUM-FIX-001', "应是第一鼓具"
print("✓ 已批准筛选正确")

print("\n--- 测试5.3: 为第二鼓具申请延期（待审批状态） ---")
r = requests.post(f"{BASE}/api/staff/extension", json={
    "drum_id": 2,
    "staff_name": "王五",
    "extension_hours": 4,
    "reason": "待审批测试"
})
print("✓ 第二鼓具延期申请成功（待审批状态）")

print("\n--- 测试5.4: 筛选待审批（extension_status=pending） ---")
r = requests.get(f"{BASE}/api/queries/borrowed-drums?extension_status=pending")
result = r.json()
assert result['count'] == 1, f"待审批记录应为1条，实际{result['count']}"
assert result['data'][0]['drum_number'] == 'DRUM-FIX-002', "应是第二鼓具"
print("✓ 待审批筛选正确")

print("\n--- 测试5.5: 拒绝第二鼓具延期申请 ---")
r = requests.post(f"{BASE}/api/admin/extension/3/reject", json={
    "approved_by": "王管理员",
    "approval_notes": "拒绝延期"
})
print("✓ 第二鼓具延期申请被拒绝")

print("\n--- 测试5.6: 筛选已拒绝（extension_status=rejected） ---")
r = requests.get(f"{BASE}/api/queries/borrowed-drums?extension_status=rejected")
result = r.json()
assert result['count'] == 1, f"已拒绝记录应为1条，实际{result['count']}"
assert result['data'][0]['drum_number'] == 'DRUM-FIX-002', "应是第二鼓具"
print("✓ 已拒绝筛选正确")

print("\n--- 测试5.7: 不筛选时应返回全部 ---")
r = requests.get(f"{BASE}/api/queries/borrowed-drums")
result = r.json()
assert result['count'] == 2, f"总记录应为2条，实际{result['count']}"
print("✓ 不筛选返回全部正确")

print("\n" + "=" * 70)
print("  ✅ 所有修复验证通过！")
print("=" * 70)

print("\n【修复总结】")
print("1. ✅ 在借清单添加延期审批状态筛选（extension_status参数）")
print("   - none: 无延期申请")
print("   - pending: 待审批")
print("   - approved: 已同意")
print("   - rejected: 已拒绝")
print("2. ✅ 在借清单补充延期相关信息")
print("   - latest_extension_status: 最新延期状态")
print("   - latest_extension_status_label: 最新延期状态标签")
print("   - latest_extension_reason: 最新延期原因")
print("   - latest_extension_approved_by: 最新审批人")
print("   - latest_extension_approved_at: 最新审批时间")
print("   - latest_extension_hours: 最新延期时长")
print("   - extension_count: 延期次数")
print("3. ✅ 延期申请校验 - 只有领用人本人才能申请延期")
print("   - 非领用人申请返回403错误")
print("   - 返回borrower和applicant信息便于调试")
print("4. ✅ 多次延期原预计归还时间取最初值")
print("   - 原预计归还时间始终是第一次延期前的时间")
print("   - 后续延期不改变原预计归还时间")
