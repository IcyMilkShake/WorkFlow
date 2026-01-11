from playwright.sync_api import sync_playwright, expect
import time

def run(playwright):
    print("Launching browser...")
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1280, 'height': 1200})
    page = context.new_page()

    print("Navigating...")
    try:
        page.goto("http://localhost:8083")
    except Exception as e:
        print(f"Error navigating: {e}")
        browser.close()
        return

    try:
        # 1. Login
        print("Logging in...")
        page.click("#googleLoginBtn")
        expect(page.locator("#dashboardPage")).to_be_visible()

        # 2. Verify Ignored Courses
        print("Verifying Courses...")
        page.click("text=Courses")

        # Wait for list
        expect(page.locator("#coursesList")).to_be_visible()

        # Find the row for AP Physics
        course_row = page.locator("#coursesList > div").filter(has_text="AP Physics").first
        expect(course_row).to_be_visible()

        # Uncheck
        checkbox = course_row.locator("input[type='checkbox']")
        checkbox.uncheck()

        # Check badge
        expect(course_row).to_contain_text("IGNORED")
        print("Course ignored.")

        # 3. Schedule Editor
        print("Checking Schedule Editor...")
        page.click("text=AI Assistant")

        # Wait for rendering
        page.wait_for_timeout(1000)

        # Check if task is gone (Lab Report is AP Physics)
        pool_list = page.locator("#taskPoolList")
        expect(pool_list).not_to_contain_text("Lab Report: Kinematics")
        print("Ignored task hidden.")

        # Check other task
        expect(pool_list).to_contain_text("Read Chapter 4")

        # 4. Drag and Drop
        print("Testing Drag and Drop...")
        task = pool_list.locator(".draggable-task").filter(has_text="Read Chapter 4").first

        # Target: A cell in the grid.
        target = page.locator(".calendar-cell").nth(40)

        task.drag_to(target)

        # Verify event
        expect(page.locator(".calendar-event")).to_contain_text("Read Chapter 4")
        print("Event scheduled.")

        # Screenshot
        print("Taking screenshot...")
        page.screenshot(path="verification/final_verify.png")

    except Exception as e:
        print(f"Test failed: {e}")
        page.screenshot(path="verification/failed_verify.png")
        raise e

    browser.close()
    print("Done.")

with sync_playwright() as playwright:
    run(playwright)
