from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    # Set viewport to desktop size
    context = browser.new_context(viewport={'width': 1280, 'height': 800})
    page = context.new_page()

    page.goto("http://localhost:8082")

    # Login (Mock)
    page.click("#googleLoginBtn")

    # Navigate to AI Assistant
    page.click("text=AI Assistant")

    expect(page.locator("#scheduleEditorSection")).to_be_visible()

    # Wait for rendering
    page.wait_for_timeout(1000)

    # Screenshot
    page.screenshot(path="verification/schedule_desktop.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
