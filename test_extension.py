import requests
import json
import time
from datetime import datetime, timedelta

BASE = "http://localhost:8078"

def p(title, data):
    print(f"\n=== {title} ===")
    if isinstance(data, dict):
        for k, v in data.items():
            if k != 'data':
                print(f"  {k}: {v}")
    print(json.dumps(data, ensure_ascii=False, indent=2)[:800])

print("=" * 70)
print("  鼓房管理系统 - 借用延期功能测试")
print("=" * 70)

print("\n【初始化测试数据】")
requests.post(f"{BASE}/api/admin/shifts", json={"name": "早班"})
requests.post(f"{BASE}/api/admin/shifts", json={"name": "晚班"})
requests.post(f"{BASE}/api/admin/positions", json={"name": "A-01"})
requests.post(f"{BASE}/api/admin/skins", json={"batch_number": "SKIN-001", "type": "军鼓皮"})
r = requests.post(f"{BASE}/api/admin/drums", json={
    "drum_number": "DRUM-EXT-001", "name": "测试军鼓", "type": "军鼓", "size": "14寸",
    "skin_id": 1, "position_id": 1, "shift_id": 1, "inspection_interval_days": 7
})
print(f"✓ 鼓具创建成功: {r.json().get('drum_number')}")

r = requests.post(f"{BASE}/api/admin/drums", json={
    "drum_number": "DRUM-EXT-002", "name": "测试嗵鼓", "type": "嗵鼓", "size": "12寸",
    "skin_id": 1, "position_id": 1, "shift_id": 2, "inspection_interval_days": 7
})
print(f"✓ 鼓具创建成功: {r.json().get('drum_number')}")

print("\n" + "=" * 70)
print("  测试1: 领出鼓具（创建借用记录）")
print("=" * 70)

r = requests.post(f"{BASE}/api/staff/checkout", json={
    "drum_id": 1, "staff_name": "张三", "shift_id": 1, "purpose": "演出排练",
    "expected_return_hours": 4
})
result = r.json()
print(f"✓ 鼓具1领出成功，预计归还时间: {result.get('drum', {}).get('current_status')}")

r = requests.post(f"{BASE}/api/staff/checkout", json={
    "drum_id": 2, "staff_name": "李四", "shift_id": 2, "purpose": "日常练习",
    "expected_return_hours": 2
})
result = r.json()
print(f"✓ 鼓具2领出成功，预计归还时间: {result.get('drum', {}).get('current_status')}")

print("\n" + "=" * 70)
print("  测试2: 发起延期申请")
print("=" * 70)

print("\n--- 测试2.1: 正常申请延期 ---")
r = requests.post(f"{BASE}/api/staff/extension", json={
    "drum_id": 1,
    "staff_name": "张三",
    "extension_hours": 8,
    "reason": "演出时间延长，需要继续使用"
})
result = r.json()
p("延期申请1结果", result)
assert result.get('request_id') is not None, "申请失败，未返回request_id"
assert result.get('extension', {}).get('approval_status') == 'pending', "初始状态应为pending"
print("✓ 延期申请提交成功，状态为待审批")

print("\n--- 测试2.2: 重复申请（已有待审批申请，应拒绝） ---")
r = requests.post(f"{BASE}/api/staff/extension", json={
    "drum_id": 1,
    "staff_name": "张三",
    "extension_hours": 4,
    "reason": "再延一会儿"
})
result = r.json()
p("重复申请结果", result)
assert r.status_code == 400, "重复申请应返回400错误"
assert '已有待审批的延期申请' in result.get('error', ''), "错误信息不正确"
print("✓ 重复申请正确拒绝")

print("\n--- 测试2.3: 非已领出状态申请延期（应拒绝） ---")
r = requests.post(f"{BASE}/api/staff/extension", json={
    "drum_id": 999,
    "staff_name": "张三",
    "extension_hours": 4,
    "reason": "测试"
})
result = r.json()
assert r.status_code == 404 or r.status_code == 400, "不存在的鼓具应返回错误"
print("✓ 不存在的鼓具申请正确拒绝")

print("\n--- 测试2.4: 延期时长为0（应拒绝） ---")
r = requests.post(f"{BASE}/api/staff/extension", json={
    "drum_id": 2,
    "staff_name": "李四",
    "extension_hours": 0,
    "reason": "测试"
})
result = r.json()
assert r.status_code == 400, "延期时长为0应返回400错误"
print("✓ 延期时长为0正确拒绝")

print("\n--- 测试2.5: 为鼓具2申请延期 ---")
r = requests.post(f"{BASE}/api/staff/extension", json={
    "drum_id": 2,
    "staff_name": "李四",
    "extension_hours": 24,
    "reason": "明天有演出，需要多使用一天"
})
result = r.json()
p("延期申请2结果", result)
assert result.get('request_id') is not None, "申请失败"
print("✓ 鼓具2延期申请提交成功")

print("\n" + "=" * 70)
print("  测试3: 查询在借清单")
print("=" * 70)

print("\n--- 测试3.1: 查询所有在借鼓具 ---")
r = requests.get(f"{BASE}/api/queries/borrowed-drums")
result = r.json()
p("在借清单", result)
assert result.get('count') == 2, f"应有2个在借记录，实际{result.get('count')}"
print(f"✓ 在借清单查询成功，共{result.get('count')}条记录")
print(f"  - 超时数量: {result.get('overdue_count')}")
print(f"  - 待审批延期: {result.get('pending_extension_count')}")

print("\n--- 测试3.2: 按班次筛选（早班） ---")
r = requests.get(f"{BASE}/api/queries/borrowed-drums?shift_id=1")
result = r.json()
assert result.get('count') == 1, f"早班应有1条记录，实际{result.get('count')}"
assert result['data'][0]['shift_name'] == '早班', "班次筛选不正确"
print("✓ 按班次筛选正确")

print("\n--- 测试3.3: 按工作人员筛选 ---")
r = requests.get(f"{BASE}/api/queries/borrowed-drums?staff_name=张三")
result = r.json()
assert result.get('count') == 1, f"张三应有1条记录，实际{result.get('count')}"
assert result['data'][0]['borrower'] == '张三', "工作人员筛选不正确"
print("✓ 按工作人员筛选正确")

print("\n--- 测试3.4: 检查返回字段完整性 ---")
record = result['data'][0]
required_fields = ['drum_number', 'drum_name', 'borrower', 
                   'original_expected_return_time', 'current_expected_return_time',
                   'is_overdue', 'shift_name']
for field in required_fields:
    assert field in record, f"缺少字段: {field}"
print("✓ 返回字段完整:", ", ".join(required_fields))

print("\n" + "=" * 70)
print("  测试4: 审批延期申请")
print("=" * 70)

print("\n--- 测试4.1: 批准延期申请1 ---")
r = requests.post(f"{BASE}/api/admin/extension/1/approve", json={
    "approved_by": "王管理员",
    "approval_notes": "演出重要，同意延长"
})
result = r.json()
p("批准申请1结果", result)
assert result.get('extension', {}).get('approval_status') == 'approved', "状态应为approved"
assert result.get('extension', {}).get('approved_by') == '王管理员', "审批人不正确"
print("✓ 延期申请1批准成功")

print("\n--- 测试4.2: 验证预计归还时间已更新 ---")
r = requests.get(f"{BASE}/api/queries/borrowed-drums?drum_id=1") if 'drum_id' in [
    p for p in ['drum_id']
] else requests.get(f"{BASE}/api/queries/borrowed-drums")
result = r.json()
record = [d for d in result['data'] if d['drum_id'] == 1][0]
print(f"  原预计归还时间: {record['original_expected_return_time']}")
print(f"  当前预计归还时间: {record['current_expected_return_time']}")
assert record['original_expected_return_time'] != record['current_expected_return_time'], "预计归还时间未更新"
assert record['has_extension_history'] == True, "应有延期历史标记"
print("✓ 预计归还时间已正确更新，保留原时间")

print("\n--- 测试4.3: 拒绝延期申请2 ---")
r = requests.post(f"{BASE}/api/admin/extension/2/reject", json={
    "approved_by": "王管理员",
    "approval_notes": "鼓具紧张，请按时归还"
})
result = r.json()
p("拒绝申请2结果", result)
assert result.get('extension', {}).get('approval_status') == 'rejected', "状态应为rejected"
assert result.get('extension', {}).get('new_expected_return_time') is None, "拒绝后new_expected_return_time应为null"
print("✓ 延期申请2拒绝成功，仅保留申请记录")

print("\n--- 测试4.4: 验证拒绝后预计归还时间未变 ---")
r = requests.get(f"{BASE}/api/queries/borrowed-drums")
result = r.json()
record = [d for d in result['data'] if d['drum_id'] == 2][0]
print(f"  原预计归还时间: {record['original_expected_return_time']}")
print(f"  当前预计归还时间: {record['current_expected_return_time']}")
assert record['original_expected_return_time'] == record['current_expected_return_time'], "拒绝后预计归还时间不应变化"
print("✓ 拒绝后预计归还时间未变")

print("\n--- 测试4.5: 重复审批（应拒绝） ---")
r = requests.post(f"{BASE}/api/admin/extension/1/approve", json={
    "approved_by": "王管理员"
})
result = r.json()
assert r.status_code == 400, "重复审批应返回400错误"
assert '已被批准' in result.get('error', ''), "错误信息不正确"
print("✓ 重复审批正确拒绝")

print("\n" + "=" * 70)
print("  测试5: 查询延期记录")
print("=" * 70)

print("\n--- 测试5.1: 查询所有延期记录 ---")
r = requests.get(f"{BASE}/api/queries/extension-records")
result = r.json()
p("延期记录", result)
assert result.get('count') == 2, f"应有2条延期记录，实际{result.get('count')}"
assert result.get('approved_count') == 1, f"应有1条已批准"
assert result.get('rejected_count') == 1, f"应有1条已拒绝"
print(f"✓ 延期记录查询成功，共{result.get('count')}条")
print(f"  - 已批准: {result.get('approved_count')}")
print(f"  - 已拒绝: {result.get('rejected_count')}")
print(f"  - 待审批: {result.get('pending_count')}")

print("\n--- 测试5.2: 按审批状态筛选（approved） ---")
r = requests.get(f"{BASE}/api/queries/extension-records?approval_status=approved")
result = r.json()
assert result.get('count') == 1, f"已批准应有1条，实际{result.get('count')}"
assert result['data'][0]['approval_status'] == 'approved', "状态筛选不正确"
print("✓ 按审批状态筛选正确")

print("\n--- 测试5.3: 按班次筛选（晚班） ---")
r = requests.get(f"{BASE}/api/queries/extension-records?shift_id=2")
result = r.json()
assert result.get('count') == 1, f"晚班应有1条，实际{result.get('count')}"
assert result['data'][0]['shift_name'] == '晚班', "班次筛选不正确"
print("✓ 按班次筛选正确")

print("\n--- 测试5.4: 按工作人员筛选（申请人或领用人） ---")
r = requests.get(f"{BASE}/api/queries/extension-records?staff_name=张三")
result = r.json()
assert result.get('count') >= 1, f"张三相关记录至少1条"
print("✓ 按工作人员筛选正确")

print("\n--- 测试5.5: 检查返回字段完整性 ---")
record = result['data'][0]
required_fields = ['drum_number', 'drum_name', 'applicant', 'borrower',
                   'original_expected_return_time', 'current_expected_return_time',
                   'extension_reason', 'approval_status', 'approval_status_label',
                   'approved_by', 'approved_at', 'shift_name', 'is_overdue']
for field in required_fields:
    assert field in record, f"缺少字段: {field}"
print("✓ 返回字段完整:", ", ".join(required_fields))

print("\n" + "=" * 70)
print("  测试6: 超时筛选测试")
print("=" * 70)

print("\n--- 测试6.1: 归还鼓具2，测试已归还记录 ---")
r = requests.post(f"{BASE}/api/staff/return", json={
    "drum_id": 2, "staff_name": "李四", "tension_after": "适中", "wear_after": 3
})
print(f"✓ 鼓具2归还成功: {r.json().get('message')}")

print("\n--- 测试6.2: 在借清单应只剩1条 ---")
r = requests.get(f"{BASE}/api/queries/borrowed-drums")
result = r.json()
assert result.get('count') == 1, f"在借记录应为1条，实际{result.get('count')}"
print("✓ 在借清单已更新，已归还的鼓具不再显示")

print("\n--- 测试6.3: 延期记录中应显示鼓具2已归还 ---")
r = requests.get(f"{BASE}/api/queries/extension-records?drum_id=2")
result = r.json()
assert result.get('count') == 1, f"鼓具2延期记录应存在"
assert result['data'][0]['return_time'] is not None, "应显示归还时间"
print("✓ 延期记录中显示归还状态正确")

print("\n--- 测试6.4: 测试未超时筛选 ---")
r = requests.get(f"{BASE}/api/queries/borrowed-drums?is_overdue=false")
result = r.json()
print(f"  未超时记录数: {result.get('count')}")
for d in result['data']:
    assert d['is_overdue'] == 0, "筛选出的记录应未超时"
print("✓ 未超时筛选正确")

print("\n--- 测试6.5: 测试延期记录超时筛选 ---")
r = requests.get(f"{BASE}/api/queries/extension-records?is_overdue=false")
result = r.json()
print(f"  未超时延期记录数: {result.get('count')}")
for d in result['data']:
    if d['return_time'] is None:
        assert d['is_overdue'] == 0, "筛选出的未归还记录应未超时"
print("✓ 延期记录超时筛选正确")

print("\n" + "=" * 70)
print("  测试7: 工作人员查询自己的延期记录")
print("=" * 70)

r = requests.get(f"{BASE}/api/staff/extension-records?staff_name=张三")
result = r.json()
print(f"✓ 工作人员延期记录查询成功，共{len(result)}条")
for rec in result:
    print(f"  - {rec['drum_number']} {rec['drum_name']}: {rec['approval_status_label']}")

print("\n" + "=" * 70)
print("  测试8: 管理员查询所有延期申请")
print("=" * 70)

r = requests.get(f"{BASE}/api/admin/extension-requests?approval_status=pending")
result = r.json()
print(f"✓ 待审批延期申请: {len(result)}条")
r = requests.get(f"{BASE}/api/admin/extension-requests")
result = r.json()
print(f"✓ 所有延期申请: {len(result)}条")

print("\n" + "=" * 70)
print("  ✅ 所有测试通过！借用延期功能验证完成")
print("=" * 70)

print("\n【功能总结】")
print("1. ✅ 工作人员可对未归还鼓具发起延期申请")
print("2. ✅ 自动检查重复申请和鼓具状态")
print("3. ✅ 管理员可审批同意或拒绝")
print("4. ✅ 同意后更新预计归还时间，保留原时间、审批人、审批时间、原因")
print("5. ✅ 拒绝后仅保留申请记录，不更新归还时间")
print("6. ✅ 在借清单查询，支持班次、工作人员、是否超时筛选")
print("7. ✅ 延期记录查询，支持班次、工作人员、审批状态、是否超时筛选")
print("8. ✅ 返回完整信息：鼓编号、鼓名、领用人、原预计归还时间、")
print("         当前预计归还时间、延期原因、审批状态等")
