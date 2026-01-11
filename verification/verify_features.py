import time
from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    page.goto("http://localhost:8082")

    # 1. Verify Loading Screen - It should be visible initially
    # If using Mock Data, it might disappear fast.

    # Click Login Button (Mock Mode triggers login immediately)
    page.click("#googleLoginBtn")

    # Wait for Dashboard
    expect(page.locator("#dashboardPage")).to_be_visible(timeout=10000)

    # 3. Check Ignored Courses Checkbox
    page.click("text=Courses") # Sidebar link
    expect(page.locator("#coursesList")).to_be_visible()

    # Verify course checkboxes exist
    expect(page.locator("#coursesList input[type='checkbox']").first).to_be_visible()

    page.screenshot(path="verification/courses_page.png")

    # 4. Check Schedule Editor
    page.click("text=AI Assistant") # Sidebar link

    # Wait for schedule editor
    expect(page.locator("#scheduleEditorSection")).to_be_visible()
    expect(page.locator(".calendar-grid")).to_be_visible()
    expect(page.locator(".task-pool")).to_be_visible()

    # Wait for task pool items (Mock data should populate them)
    # expect(page.locator(".draggable-task").first).to_be_visible(timeout=5000)

    # Take screenshot of Schedule Editor
    page.screenshot(path="verification/schedule_editor.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
