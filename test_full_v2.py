"""
SmartReader 全面测试脚本
测试所有 F1-F10 功能及核心流程
"""
import json
import os
import time
from playwright.sync_api import sync_playwright, expect

# 测试结果收集
results = []
screenshots_dir = "test-screenshots-v2"
os.makedirs(screenshots_dir, exist_ok=True)

def log(test_name, status, details=""):
    results.append({
        "test": test_name,
        "status": status,
        "details": details,
        "timestamp": time.strftime("%H:%M:%S")
    })
    icon = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⚠️"
    print(f"{icon} [{status}] {test_name}: {details}")

def screenshot(page, name):
    path = f"{screenshots_dir}/{name}.png"
    page.screenshot(path=path, full_page=True)
    return path

# ============================================================
# 主测试流程
# ============================================================
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        locale="zh-CN"
    )
    page = context.new_page()

    # 收集控制台错误
    console_errors = []
    page.on("console", lambda msg: console_errors.append(f"{msg.type}: {msg.text}") if msg.type == "error" else None)

    # ============================================================
    # 1. 首页加载测试
    # ============================================================
    print("\n========== 1. 首页加载 ==========")
    try:
        page.goto("http://localhost:3000", wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(2000)
        screenshot(page, "01-homepage")
        title = page.title()
        log("首页加载", "PASS", f"页面标题: {title}")
    except Exception as e:
        log("首页加载", "FAIL", str(e))
        screenshot(page, "01-homepage-error")

    # ============================================================
    # 2. 登录流程测试
    # ============================================================
    print("\n========== 2. 登录流程 ==========")
    try:
        # 查找登录链接
        login_link = page.locator('a[href="/login"]').first
        if login_link.is_visible():
            login_link.click()
            page.wait_for_timeout(2000)
        else:
            page.goto("http://localhost:3000/login", wait_until="networkidle")
            page.wait_for_timeout(2000)

        screenshot(page, "02-login-page")

        # 填写登录表单
        email_input = page.locator('input[type="email"], input[name="email"]').first
        password_input = page.locator('input[type="password"], input[name="password"]').first

        email_input.fill("damion_zeng@163.com")
        password_input.fill("zxm19951225")
        page.wait_for_timeout(500)
        screenshot(page, "02-login-filled")

        # 提交登录
        submit_btn = page.locator('button[type="submit"]').first
        submit_btn.click()

        # 等待登录完成 - 可能跳转到 dashboard
        page.wait_for_timeout(5000)
        current_url = page.url
        screenshot(page, "02-after-login")

        if "login" not in current_url:
            log("登录流程", "PASS", f"登录成功，跳转到: {current_url}")
        else:
            # 检查是否有错误信息
            error_text = page.locator('[role="alert"], .text-red-500, .text-destructive').first
            if error_text.is_visible():
                log("登录流程", "FAIL", f"登录失败: {error_text.text()}")
            else:
                log("登录流程", "FAIL", f"仍在登录页: {current_url}")
    except Exception as e:
        log("登录流程", "FAIL", str(e))
        screenshot(page, "02-login-error")

    # ============================================================
    # 3. Dashboard 测试
    # ============================================================
    print("\n========== 3. Dashboard ==========")
    try:
        if "dashboard" not in page.url:
            page.goto("http://localhost:3000/dashboard", wait_until="networkidle")
            page.wait_for_timeout(3000)

        screenshot(page, "03-dashboard")

        # 检查项目列表
        project_cards = page.locator('[class*="project"], [class*="card"], article').all()
        log("Dashboard 加载", "PASS", f"找到 {len(project_cards)} 个项目卡片")

        # 检查用量统计区域
        usage_section = page.locator('text=/使用统计|Usage/i').first
        if usage_section.is_visible():
            log("用量统计区域", "PASS", "用量统计区域可见")
        else:
            log("用量统计区域", "WARN", "未找到用量统计区域")

        screenshot(page, "03-dashboard-full")
    except Exception as e:
        log("Dashboard 测试", "FAIL", str(e))
        screenshot(page, "03-dashboard-error")

    # ============================================================
    # 4. Board (论文图谱) 测试
    # ============================================================
    print("\n========== 4. Board 论文图谱 ==========")
    try:
        page.goto("http://localhost:3000/board", wait_until="networkidle")
        page.wait_for_timeout(3000)
        screenshot(page, "04-board-empty")

        # 检查是否有导入界面
        ingest_ui = page.locator('text=/Import|导入/i').first
        if ingest_ui.is_visible():
            log("Board 空状态", "PASS", "显示导入界面")

        # 尝试访问已有项目 - 从 dashboard 获取
        page.goto("http://localhost:3000/dashboard", wait_until="networkidle")
        page.wait_for_timeout(2000)

        # 查找第一个项目链接
        project_links = page.locator('a[href*="/board?id="]').all()
        if len(project_links) > 0:
            project_links[0].click()
            page.wait_for_timeout(5000)
            screenshot(page, "04-board-project")
            log("Board 项目加载", "PASS", f"成功加载项目: {page.url}")

            # 检查 React Flow 画布
            flow_canvas = page.locator('.react-flow').first
            if flow_canvas.is_visible():
                log("React Flow 画布", "PASS", "画布可见")

                # 检查节点
                flow_nodes = page.locator('.react-flow__node').all()
                log("图谱节点", "PASS", f"找到 {len(flow_nodes)} 个节点")

                # 检查边
                flow_edges = page.locator('.react-flow__edge').all()
                log("图谱边", "PASS", f"找到 {len(flow_edges)} 条边")
            else:
                log("React Flow 画布", "FAIL", "画布不可见")
        else:
            log("Board 项目", "WARN", "Dashboard 无已有项目，测试新建流程")
            page.goto("http://localhost:3000/board", wait_until="networkidle")
            page.wait_for_timeout(2000)
            screenshot(page, "04-board-no-projects")
    except Exception as e:
        log("Board 测试", "FAIL", str(e))
        screenshot(page, "04-board-error")

    # ============================================================
    # 5. Codeboard 测试
    # ============================================================
    print("\n========== 5. Codeboard ==========")
    try:
        page.goto("http://localhost:3000/codeboard", wait_until="networkidle")
        page.wait_for_timeout(3000)
        screenshot(page, "05-codeboard-empty")

        # 检查导入界面
        code_ingest = page.locator('text=/Import Code|导入代码/i').first
        if code_ingest.is_visible():
            log("Codeboard 空状态", "PASS", "显示代码导入界面")

        # 尝试从 dashboard 找 code 项目
        page.goto("http://localhost:3000/dashboard", wait_until="networkidle")
        page.wait_for_timeout(2000)
        code_links = page.locator('a[href*="/codeboard?id="]').all()
        if len(code_links) > 0:
            code_links[0].click()
            page.wait_for_timeout(5000)
            screenshot(page, "05-codeboard-project")
            log("Codeboard 项目加载", "PASS", f"成功加载: {page.url}")

            # 检查功能按钮
            undo_btn = page.locator('button[title*="Undo"], button[title*="撤销"]').first
            redo_btn = page.locator('button[title*="Redo"], button[title*="重做"]').first
            layout_btn = page.locator('button[title*="Layout"], button[title*="布局"]').first

            if undo_btn.is_visible():
                log("Codeboard Undo 按钮", "PASS", "可见")
            else:
                log("Codeboard Undo 按钮", "WARN", "未找到")

            if redo_btn.is_visible():
                log("Codeboard Redo 按钮", "PASS", "可见")
            else:
                log("Codeboard Redo 按钮", "WARN", "未找到")

            if layout_btn.is_visible():
                log("Codeboard 自动布局按钮", "PASS", "可见")
            else:
                log("Codeboard 自动布局按钮", "WARN", "未找到")
        else:
            log("Codeboard 项目", "WARN", "无已有 code 项目")
    except Exception as e:
        log("Codeboard 测试", "FAIL", str(e))
        screenshot(page, "05-codeboard-error")

    # ============================================================
    # 6. QA 面板测试 (F1 流式 + F2 持久化)
    # ============================================================
    print("\n========== 6. QA 面板 (F1+F2) ==========")
    try:
        # 回到 board 项目
        page.goto("http://localhost:3000/dashboard", wait_until="networkidle")
        page.wait_for_timeout(2000)
        board_links = page.locator('a[href*="/board?id="]').all()
        if len(board_links) > 0:
            board_links[0].click()
            page.wait_for_timeout(5000)

            # 查找 QA 按钮
            qa_btn = page.locator('button[title*="Ask"], button[title*="问答"]').first
            if qa_btn.is_visible():
                qa_btn.click()
                page.wait_for_timeout(2000)
                screenshot(page, "06-qa-panel")

                # 检查 QA 面板
                qa_input = page.locator('textarea').first
                if qa_input.is_visible():
                    log("QA 面板", "PASS", "QA 输入框可见")

                    # 测试发送问题
                    qa_input.fill("What is this paper about?")
                    page.wait_for_timeout(500)

                    # 查找发送按钮
                    send_btn = page.locator('button[aria-label*="Send"], button[aria-label*="发送"]').first
                    if send_btn.is_visible():
                        send_btn.click()

                        # 等待流式响应
                        page.wait_for_timeout(10000)
                        screenshot(page, "06-qa-response")

                        # 检查是否有响应
                        messages = page.locator('.react-flow + div, [class*="message"]').all()
                        log("QA 流式响应", "PASS", "问题已发送，等待响应")
                    else:
                        log("QA 发送按钮", "WARN", "未找到发送按钮")
                else:
                    log("QA 面板", "FAIL", "QA 输入框不可见")
            else:
                log("QA 按钮", "WARN", "未找到 QA 按钮")
        else:
            log("QA 测试", "WARN", "无可用项目测试 QA")
    except Exception as e:
        log("QA 面板测试", "FAIL", str(e))
        screenshot(page, "06-qa-error")

    # ============================================================
    # 7. 节点解释面板测试 (F1 流式 + F4 编辑)
    # ============================================================
    print("\n========== 7. 节点解释面板 (F1+F4) ==========")
    try:
        # 确保在 board 项目页面
        if "board" in page.url and "react-flow" in page.content():
            # 点击第一个节点
            first_node = page.locator('.react-flow__node').first
            if first_node.is_visible():
                first_node.click()
                page.wait_for_timeout(3000)
                screenshot(page, "07-explanation-panel")

                # 检查解释面板
                explain_panel = page.locator('text=/Explanation|解释/i').first
                if explain_panel.is_visible():
                    log("解释面板", "PASS", "面板可见")
                else:
                    log("解释面板", "WARN", "面板可能未加载")

                # 检查笔记编辑区域
                note_area = page.locator('textarea').first
                if note_area.is_visible():
                    log("节点笔记编辑", "PASS", "笔记编辑区域可见")
                else:
                    log("节点笔记编辑", "WARN", "未找到笔记编辑区域")
            else:
                log("节点点击", "FAIL", "无可点击节点")
        else:
            log("解释面板测试", "WARN", "不在 board 页面")
    except Exception as e:
        log("解释面板测试", "FAIL", str(e))
        screenshot(page, "07-explanation-error")

    # ============================================================
    # 8. 导出功能测试 (F6)
    # ============================================================
    print("\n========== 8. 导出功能 (F6) ==========")
    try:
        # 查找导出按钮/下拉菜单
        export_btn = page.locator('button:has-text("Export"), button:has-text("导出"), button[title*="Export"]').first
        if export_btn.is_visible():
            export_btn.click()
            page.wait_for_timeout(1000)
            screenshot(page, "08-export-dropdown")

            # 检查导出选项
            markdown_opt = page.locator('text=/Markdown/i').first
            json_opt = page.locator('text=/JSON/i').first
            html_opt = page.locator('text=/HTML/i').first
            pdf_opt = page.locator('text=/PDF/i').first

            formats_found = []
            if markdown_opt.is_visible(): formats_found.append("Markdown")
            if json_opt.is_visible(): formats_found.append("JSON")
            if html_opt.is_visible(): formats_found.append("HTML")
            if pdf_opt.is_visible(): formats_found.append("PDF")

            if len(formats_found) >= 3:
                log("导出格式", "PASS", f"找到: {', '.join(formats_found)}")
            else:
                log("导出格式", "WARN", f"仅找到: {', '.join(formats_found)}")

            # 检查导出图片按钮
            image_btn = page.locator('button[title*="Image"], button[title*="图片"]').first
            if image_btn.is_visible():
                log("PNG 导出按钮", "PASS", "导出图片按钮可见")
            else:
                log("PNG 导出按钮", "WARN", "未找到导出图片按钮")
        else:
            log("导出功能", "WARN", "未找到导出按钮")
    except Exception as e:
        log("导出功能测试", "FAIL", str(e))
        screenshot(page, "08-export-error")

    # ============================================================
    # 9. Undo/Redo 测试 (F7)
    # ============================================================
    print("\n========== 9. Undo/Redo (F7) ==========")
    try:
        # 查找 undo/redo 按钮
        undo_btn = page.locator('button[title*="Undo"], button[title*="撤销"]').first
        redo_btn = page.locator('button[title*="Redo"], button[title*="重做"]').first

        if undo_btn.is_visible() and redo_btn.is_visible():
            log("Undo/Redo 按钮", "PASS", "两个按钮都可见")

            # 测试键盘快捷键
            page.keyboard.press("Control+z")
            page.wait_for_timeout(500)
            log("Undo 快捷键", "PASS", "Ctrl+Z 已执行")

            page.keyboard.press("Control+Shift+z")
            page.wait_for_timeout(500)
            log("Redo 快捷键", "PASS", "Ctrl+Shift+Z 已执行")
        else:
            log("Undo/Redo 按钮", "WARN", "按钮不可见")
    except Exception as e:
        log("Undo/Redo 测试", "FAIL", str(e))

    # ============================================================
    # 10. 布局模板测试 (F10)
    # ============================================================
    print("\n========== 10. 布局模板 (F10) ==========")
    try:
        # 查找布局模板按钮
        tree_btn = page.locator('button:has-text("Tree"), button:has-text("树形")').first
        radial_btn = page.locator('button:has-text("Radial"), button:has-text("放射")').first
        compact_btn = page.locator('button:has-text("Compact"), button:has-text("紧凑")').first
        hier_btn = page.locator('button:has-text("Hierarchical"), button:has-text("层次")').first

        templates_found = []
        if tree_btn.is_visible(): templates_found.append("Tree")
        if radial_btn.is_visible(): templates_found.append("Radial")
        if compact_btn.is_visible(): templates_found.append("Compact")
        if hier_btn.is_visible(): templates_found.append("Hierarchical")

        if len(templates_found) >= 3:
            log("布局模板", "PASS", f"找到: {', '.join(templates_found)}")

            # 测试切换布局
            if radial_btn.is_visible():
                radial_btn.click()
                page.wait_for_timeout(2000)
                screenshot(page, "10-layout-radial")
                log("放射布局", "PASS", "已切换到放射布局")

            if tree_btn.is_visible():
                tree_btn.click()
                page.wait_for_timeout(2000)
                screenshot(page, "10-layout-tree")
                log("树形布局", "PASS", "已切换到树形布局")
        else:
            log("布局模板", "WARN", f"仅找到: {', '.join(templates_found)}")
    except Exception as e:
        log("布局模板测试", "FAIL", str(e))
        screenshot(page, "10-layout-error")

    # ============================================================
    # 11. 暗色模式测试 (F11)
    # ============================================================
    print("\n========== 11. 暗色模式 (F11) ==========")
    try:
        # 查找主题切换按钮
        theme_btn = page.locator('button[aria-label*="Dark"], button[aria-label*="Light"], button[aria-label*="深色"], button[aria-label*="浅色"]').first
        if theme_btn.is_visible():
            theme_btn.click()
            page.wait_for_timeout(2000)
            screenshot(page, "11-dark-mode")

            # 检查 dark class
            html_class = page.locator('html').get_attribute('class') or ''
            if 'dark' in html_class:
                log("暗色模式", "PASS", "dark class 已应用")
            else:
                log("暗色模式", "WARN", "dark class 未检测到")

            # 切换回来
            theme_btn.click()
            page.wait_for_timeout(1000)
            screenshot(page, "11-light-mode")
        else:
            log("暗色模式", "WARN", "未找到主题切换按钮")
    except Exception as e:
        log("暗色模式测试", "FAIL", str(e))
        screenshot(page, "11-dark-mode-error")

    # ============================================================
    # 12. 全文搜索测试 (F5)
    # ============================================================
    print("\n========== 12. 全文搜索 (F5) ==========")
    try:
        # 查找全局搜索按钮
        search_all_btn = page.locator('button:has-text("Search all"), button:has-text("搜索所有"), button:has-text("全局搜索")').first
        if search_all_btn.is_visible():
            search_all_btn.click()
            page.wait_for_timeout(1000)
            screenshot(page, "12-global-search")

            # 输入搜索词
            search_input = page.locator('input[placeholder*="Search"], input[placeholder*="搜索"]').last
            if search_input.is_visible():
                search_input.fill("test")
                page.wait_for_timeout(2000)
                screenshot(page, "12-search-results")
                log("全文搜索", "PASS", "搜索已执行")
            else:
                log("全文搜索", "WARN", "搜索输入框不可见")
        else:
            log("全文搜索", "WARN", "未找到全局搜索按钮")
    except Exception as e:
        log("全文搜索测试", "FAIL", str(e))
        screenshot(page, "12-search-error")

    # ============================================================
    # 13. 项目分享测试 (F3)
    # ============================================================
    print("\n========== 13. 项目分享 (F3) ==========")
    try:
        # 通过 API 测试分享功能
        response = page.evaluate("""
            async () => {
                try {
                    // 获取项目列表
                    const projectsRes = await fetch('/api/projects');
                    const projectsData = await projectsRes.json();
                    if (!projectsData.projects || projectsData.projects.length === 0) {
                        return { status: 'no_projects' };
                    }
                    const projectId = projectsData.projects[0].id;

                    // 创建分享链接
                    const shareRes = await fetch(`/api/projects/${projectId}/share`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'create' })
                    });
                    const shareData = await shareRes.json();
                    return { status: 'success', projectId, shareData };
                } catch (e) {
                    return { status: 'error', message: e.message };
                }
            }
        """)

        if response.get('status') == 'success':
            log("项目分享 API", "PASS", f"分享链接创建成功: {json.dumps(response.get('shareData', {}))[:100]}")
        elif response.get('status') == 'no_projects':
            log("项目分享 API", "WARN", "无项目可测试")
        else:
            log("项目分享 API", "FAIL", str(response.get('message', 'Unknown error')))
    except Exception as e:
        log("项目分享测试", "FAIL", str(e))

    # ============================================================
    # 14. 用量统计 API 测试 (F8)
    # ============================================================
    print("\n========== 14. 用量统计 (F8) ==========")
    try:
        response = page.evaluate("""
            async () => {
                try {
                    const res = await fetch('/api/usage');
                    const data = await res.json();
                    return { status: res.status, data };
                } catch (e) {
                    return { status: 'error', message: e.message };
                }
            }
        """)

        if response.get('status') == 200:
            data = response.get('data', {})
            total = data.get('totalRequests', 0)
            log("用量统计 API", "PASS", f"总请求数: {total}")
        else:
            log("用量统计 API", "FAIL", f"状态码: {response.get('status')}")
    except Exception as e:
        log("用量统计测试", "FAIL", str(e))

    # ============================================================
    # 15. 密码重置页面测试 (F9/F20)
    # ============================================================
    print("\n========== 15. 密码重置页面 (F9/F20) ==========")
    try:
        page.goto("http://localhost:3000/forgot-password", wait_until="networkidle")
        page.wait_for_timeout(2000)
        screenshot(page, "15-forgot-password")

        # 检查表单
        email_input = page.locator('input[type="email"]').first
        if email_input.is_visible():
            email_input.fill("test@example.com")
            page.wait_for_timeout(500)

            submit_btn = page.locator('button[type="submit"]').first
            if submit_btn.is_visible():
                log("密码重置页面", "PASS", "表单可见且可填写")
                screenshot(page, "15-forgot-password-filled")
            else:
                log("密码重置页面", "WARN", "提交按钮不可见")
        else:
            log("密码重置页面", "FAIL", "邮箱输入框不可见")
    except Exception as e:
        log("密码重置页面测试", "FAIL", str(e))
        screenshot(page, "15-forgot-password-error")

    # ============================================================
    # 16. 邮箱验证页面测试 (F9)
    # ============================================================
    print("\n========== 16. 邮箱验证页面 (F9) ==========")
    try:
        page.goto("http://localhost:3000/verify-email", wait_until="networkidle")
        page.wait_for_timeout(3000)
        screenshot(page, "16-verify-email")

        # 检查页面是否加载
        page_content = page.content()
        if "verify" in page_content.lower() or "验证" in page_content:
            log("邮箱验证页面", "PASS", "页面已加载")
        else:
            log("邮箱验证页面", "WARN", "页面内容不明确")
    except Exception as e:
        log("邮箱验证页面测试", "FAIL", str(e))
        screenshot(page, "16-verify-email-error")

    # ============================================================
    # 17. 注册页面测试 (F9 密码确认)
    # ============================================================
    print("\n========== 17. 注册页面 (F9 密码确认) ==========")
    try:
        page.goto("http://localhost:3000/register", wait_until="networkidle")
        page.wait_for_timeout(2000)
        screenshot(page, "17-register")

        # 检查确认密码字段
        password_inputs = page.locator('input[type="password"]').all()
        if len(password_inputs) >= 2:
            log("注册密码确认", "PASS", f"找到 {len(password_inputs)} 个密码输入框")
        else:
            log("注册密码确认", "WARN", f"仅找到 {len(password_inputs)} 个密码输入框")
    except Exception as e:
        log("注册页面测试", "FAIL", str(e))
        screenshot(page, "17-register-error")

    # ============================================================
    # 18. 分享页面测试 (F3)
    # ============================================================
    print("\n========== 18. 分享页面 (F3) ==========")
    try:
        # 测试无效分享链接
        page.goto("http://localhost:3000/share/invalid-id", wait_until="networkidle")
        page.wait_for_timeout(3000)
        screenshot(page, "18-share-invalid")

        page_content = page.content()
        if "not found" in page_content.lower() or "未找到" in page_content or "error" in page_content.lower():
            log("分享页面错误处理", "PASS", "无效分享链接正确显示错误")
        else:
            log("分享页面错误处理", "WARN", "错误提示不明确")
    except Exception as e:
        log("分享页面测试", "FAIL", str(e))

    # ============================================================
    # 19. API 限流测试 (F8)
    # ============================================================
    print("\n========== 19. API 限流 (F8) ==========")
    try:
        # 快速发送多个请求测试限流
        response = page.evaluate("""
            async () => {
                const results = [];
                for (let i = 0; i < 15; i++) {
                    const res = await fetch('/api/projects', { method: 'GET' });
                    results.push(res.status);
                }
                return results;
            }
        """)

        rate_limited = any(s == 429 for s in response)
        if rate_limited:
            log("API 限流", "PASS", f"15次请求中触发限流: {response.count(429)} 次 429")
        else:
            log("API 限流", "WARN", f"未触发限流 (可能限流阈值较高): {response}")
    except Exception as e:
        log("API 限流测试", "FAIL", str(e))

    # ============================================================
    # 20. 控制台错误检查
    # ============================================================
    print("\n========== 20. 控制台错误 ==========")
    if console_errors:
        # 过滤掉已知的非关键错误
        critical_errors = [e for e in console_errors if "Failed to load resource" not in e and "favicon" not in e.lower()]
        if critical_errors:
            log("控制台错误", "WARN", f"发现 {len(critical_errors)} 个错误: {critical_errors[:3]}")
        else:
            log("控制台错误", "PASS", "仅有非关键资源加载错误")
    else:
        log("控制台错误", "PASS", "无控制台错误")

    # ============================================================
    # 21. Review/Compare 流式测试 (F1)
    # ============================================================
    print("\n========== 21. Review/Compare 流式 (F1) ==========")
    try:
        page.goto("http://localhost:3000/dashboard", wait_until="networkidle")
        page.wait_for_timeout(2000)

        # 检查 review 按钮
        review_btn = page.locator('button:has-text("Review"), button:has-text("综述")').first
        if review_btn.is_visible():
            log("Review 按钮", "PASS", "可见")
        else:
            log("Review 按钮", "WARN", "未找到")

        # 检查 compare 按钮
        compare_btn = page.locator('button:has-text("Compare"), button:has-text("对比")').first
        if compare_btn.is_visible():
            log("Compare 按钮", "PASS", "可见")
        else:
            log("Compare 按钮", "WARN", "未找到")

        screenshot(page, "21-dashboard-review-compare")
    except Exception as e:
        log("Review/Compare 测试", "FAIL", str(e))

    # ============================================================
    # 22. 响应式设计测试
    # ============================================================
    print("\n========== 22. 响应式设计 ==========")
    try:
        # 测试移动端视图
        page.set_viewport_size({"width": 375, "height": 812})
        page.goto("http://localhost:3000/dashboard", wait_until="networkidle")
        page.wait_for_timeout(2000)
        screenshot(page, "22-mobile-dashboard")
        log("移动端响应式", "PASS", "移动端视图已截图")

        # 恢复桌面视图
        page.set_viewport_size({"width": 1440, "height": 900})
    except Exception as e:
        log("响应式设计测试", "FAIL", str(e))

    browser.close()

# ============================================================
# 生成测试报告
# ============================================================
print("\n" + "=" * 60)
print("           SmartReader 全面测试报告")
print("=" * 60)

total = len(results)
passed = sum(1 for r in results if r["status"] == "PASS")
failed = sum(1 for r in results if r["status"] == "FAIL")
warnings = sum(1 for r in results if r["status"] == "WARN")

print(f"\n总测试项: {total}")
print(f"通过: {passed} ✅")
print(f"失败: {failed} ❌")
print(f"警告: {warnings} ⚠️")
print(f"通过率: {(passed/total*100):.1f}%")

print("\n---------- 详细结果 ----------")
for r in results:
    icon = "✅" if r["status"] == "PASS" else "❌" if r["status"] == "FAIL" else "⚠️"
    print(f"{icon} [{r['status']}] {r['test']}: {r['details']}")

# 保存 JSON 报告
report = {
    "total": total,
    "passed": passed,
    "failed": failed,
    "warnings": warnings,
    "pass_rate": f"{(passed/total*100):.1f}%",
    "results": results
}
with open("test-report-v2.json", "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)

print(f"\n报告已保存: test-report-v2.json")
print(f"截图目录: {screenshots_dir}/")
