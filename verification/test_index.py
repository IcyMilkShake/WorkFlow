
from playwright.sync_api import sync_playwright

def verify_dashboard():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app
        page.goto("http://localhost:3000")

        # Click login button
        page.click("#googleLoginBtn")

        # Wait for dashboard to be visible
        page.wait_for_selector("#dashboardPage", state="visible")

        # Wait for assignments to load (checking for assignment cards)
        # In mock mode it has a small delay
        page.wait_for_selector(".assignment-card", state="visible")

        # Take screenshot
        page.screenshot(path="verification/dashboard.png")

        print("Screenshot taken at verification/dashboard.png")
        browser.close()

if __name__ == "__main__":
    verify_dashboard()
