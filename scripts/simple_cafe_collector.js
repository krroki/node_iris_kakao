const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

async function simpleCafeCollection() {
    const browser = await chromium.launch({
        headless: false, // Keep visible for manual intervention
        slowMo: 500
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();

    try {
        console.log('🚀 Starting simple Naver cafe collection...');

        // Navigate directly to the cafe board (this will trigger login if needed)
        const targetUrl = 'https://cafe.naver.com/f-e/cafes/29537083/menus/383';
        console.log(`📍 Going to: ${targetUrl}`);

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);

        // Check if we need to login
        const currentUrl = page.url();
        console.log(`Current URL: ${currentUrl}`);

        if (currentUrl.includes('nidlogin') || currentUrl.includes('login')) {
            console.log('🔐 Login required. Please login manually in the browser window.');
            console.log('The browser will stay open for 60 seconds for manual login...');

            // Wait for manual login
            await page.waitForTimeout(60000);

            // After manual login, try to navigate to the target again
            console.log('🔄 Attempting to navigate to target page again...');
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(3000);
        }

        // Check if we're on the right page
        const pageTitle = await page.title();
        console.log(`📄 Page title: ${pageTitle}`);

        // Take screenshot to verify we're on the right page
        await page.screenshot({ path: path.join(__dirname, '..', 'cafe_data', 'current_page.png'), fullPage: true });

        // Try to find post elements
        console.log('🔍 Looking for posts...');

        // Try different possible selectors for posts
        const possibleSelectors = [
            '.article-board tr[data-article-id]',
            '.article-list .article-item',
            '.board-list .list-item',
            '.cafe-board .article',
            '[class*="article"]',
            'table tr'
        ];

        let postsFound = false;
        let posts = [];

        for (const selector of possibleSelectors) {
            try {
                const elements = await page.locator(selector).count();
                console.log(`Found ${elements} elements with selector: ${selector}`);

                if (elements > 0) {
                    postsFound = true;

                    // Extract basic information from these elements
                    posts = await page.locator(selector).all().slice(0, 10).map(async (element, index) => {
                        try {
                            const text = await element.textContent();
                            const html = await element.innerHTML();

                            return {
                                index: index,
                                text: text?.substring(0, 200) || 'No text',
                                html: html?.substring(0, 500) || 'No HTML',
                                selector: selector
                            };
                        } catch (error) {
                            return {
                                index: index,
                                error: error.message,
                                selector: selector
                            };
                        }
                    });

                    break;
                }
            } catch (error) {
                console.log(`Error with selector ${selector}: ${error.message}`);
            }
        }

        if (!postsFound) {
            console.log('❌ No posts found with any selector. Getting page HTML for analysis...');

            const pageHTML = await page.content();
            fs.writeFileSync(path.join(__dirname, '..', 'cafe_data', 'page_analysis.html'), pageHTML);

            // Look for any links that might be posts
            const links = await page.evaluate(() => {
                const linkElements = Array.from(document.querySelectorAll('a[href*="article"], a[href*="Article"], a[href*="post"]'));
                return linkElements.map(link => ({
                    text: link.textContent.trim(),
                    href: link.href,
                    className: link.className
                })).slice(0, 20);
            });

            console.log(`Found ${links.length} potential post links:`);
            links.forEach((link, index) => {
                console.log(`${index + 1}. ${link.text} -> ${link.href}`);
            });

            fs.writeFileSync(path.join(__dirname, '..', 'cafe_data', 'potential_links.json'), JSON.stringify(links, null, 2));
        } else {
            console.log(`✅ Found posts! Processing ${posts.length} posts...`);

            const resolvedPosts = await Promise.all(posts);

            // Save the found posts
            const result = {
                timestamp: new Date().toISOString(),
                url: page.url(),
                title: pageTitle,
                postsFound: postsFound,
                postCount: resolvedPosts.length,
                posts: resolvedPosts
            };

            fs.writeFileSync(path.join(__dirname, '..', 'cafe_data', 'found_posts.json'), JSON.stringify(result, null, 2));
            console.log('📁 Results saved to cafe_data/found_posts.json');
        }

        console.log('✅ Collection attempt completed. Check cafe_data/ for results.');

        // Keep browser open for 30 seconds for manual inspection
        console.log('🔍 Keeping browser open for 30 seconds for inspection...');
        await page.waitForTimeout(30000);

    } catch (error) {
        console.error('❌ Error:', error.message);

        try {
            await page.screenshot({ path: path.join(__dirname, '..', 'cafe_data', 'error_page.png'), fullPage: true });
            console.log('📷 Error screenshot saved');
        } catch (screenshotError) {
            console.error('Could not save error screenshot:', screenshotError);
        }
    } finally {
        await browser.close();
    }
}

simpleCafeCollection().catch(console.error);