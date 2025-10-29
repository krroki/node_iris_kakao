const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Create output directory if it doesn't exist
const outputDir = path.join(__dirname, '..', 'cafe_data');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

async function collectIrisPosts() {
    const browser = await chromium.launch({
        headless: false, // Show browser for debugging login issues
        slowMo: 1000 // Slow down actions for better reliability
    });

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    try {
        console.log('🔍 Starting IRIS posts collection...');

        // Step 1: Navigate to Naver login page
        console.log('📍 Navigating to Naver login page...');
        await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'networkidle' });

        // Wait for login form to be ready
        await page.waitForSelector('#id', { timeout: 10000 });

        // Step 2: Fill in login credentials
        console.log('🔑 Entering login credentials...');
        await page.fill('#id', 'jyr9885');
        await page.fill('#pw', 'skanfgprud$4160');

        // Handle potential security popup or captcha
        await page.waitForTimeout(2000);

        // Check for security challenges before clicking
        const hasSecurityCheck = await page.locator('.error_common, .security_challenge, #captcha').count() > 0;
        if (hasSecurityCheck) {
            console.log('⚠️ Security challenge detected. Please complete manually or wait...');
            await page.waitForTimeout(10000); // Wait for manual intervention
        }

        // Click login button with better error handling
        try {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
                page.click('.btn_global[type="submit"]')
            ]);
        } catch (error) {
            console.log('⚠️ Login navigation timeout, checking if login was successful...');
        }

        // Verify login success by checking for common post-login elements
        await page.waitForTimeout(3000);

        // Check if we're still on login page (failed login)
        const currentUrl = page.url();
        if (currentUrl.includes('nidlogin') || currentUrl.includes('login')) {
            console.log('❌ Login failed - still on login page');
            throw new Error('Login failed - credentials may be incorrect or security challenge present');
        }

        console.log('✅ Login successful!');

        // Step 3: Navigate to IRIS guide board
        const irisBoardUrl = 'https://cafe.naver.com/f-e/cafes/29537083/menus/383';
        console.log('📍 Navigating to IRIS guide board...');
        await page.goto(irisBoardUrl, { waitUntil: 'networkidle', timeout: 30000 });

        // Wait for the page to load
        await page.waitForTimeout(3000);

        // Check if we successfully accessed the board
        const pageTitle = await page.title();
        console.log(`📄 Page title: ${pageTitle}`);

        // Take screenshot for verification
        await page.screenshot({ path: path.join(outputDir, 'iris_board_initial.png'), fullPage: true });

        // Step 4: Collect all posts from multiple pages
        const allPosts = [];
        let currentPage = 1;
        let hasMorePages = true;

        while (hasMorePages) {
            console.log(`📖 Collecting posts from page ${currentPage}...`);

            // Wait for post list to load
            await page.waitForSelector('.article-board', { timeout: 10000 });

            // Get all posts on current page
            const posts = await page.evaluate(() => {
                const postElements = document.querySelectorAll('.article-board tr[data-article-id]');
                const posts = [];

                postElements.forEach(element => {
                    try {
                        const articleId = element.getAttribute('data-article-id');
                        const titleElement = element.querySelector('.article-title a');
                        const authorElement = element.querySelector('.article-nick');
                        const dateElement = element.querySelector('.article-date');
                        const viewCountElement = element.querySelector('.article-count');

                        if (titleElement && articleId) {
                            posts.push({
                                articleId: articleId,
                                title: titleElement.textContent.trim(),
                                author: authorElement ? authorElement.textContent.trim() : 'Unknown',
                                date: dateElement ? dateElement.textContent.trim() : '',
                                viewCount: viewCountElement ? viewCountElement.textContent.trim() : '0',
                                url: titleElement.href
                            });
                        }
                    } catch (error) {
                        console.error('Error parsing post element:', error);
                    }
                });

                return posts;
            });

            console.log(`📝 Found ${posts.length} posts on page ${currentPage}`);
            allPosts.push(...posts);

            // Check for next page
            const nextButton = await page.$('.prev-next a[onclick*="movePage"]:not([disabled])');
            if (nextButton && currentPage < 10) { // Limit to first 10 pages for safety
                console.log('➡️ Moving to next page...');
                await nextButton.click();
                await page.waitForLoadState('networkidle');
                await page.waitForTimeout(2000);
                currentPage++;
            } else {
                hasMorePages = false;
                console.log('🏁 Reached last page or page limit');
            }
        }

        console.log(`📚 Total posts collected: ${allPosts.length}`);

        // Step 5: Extract detailed content from each post
        const detailedPosts = [];
        let processedCount = 0;

        for (let i = 0; i < Math.min(allPosts.length, 20); i++) { // Limit to first 20 posts for safety
            const post = allPosts[i];
            console.log(`🔍 Processing post ${i + 1}/${Math.min(allPosts.length, 20)}: ${post.title}`);

            try {
                // Open post in new tab
                const postPage = await context.newPage();
                await postPage.goto(post.url, { waitUntil: 'networkidle', timeout: 15000 });
                await postPage.waitForTimeout(2000);

                // Extract post content
                const postContent = await postPage.evaluate(() => {
                    try {
                        // Get main content
                        const contentElement = document.querySelector('.article-content') ||
                                             document.querySelector('.se-main-container') ||
                                             document.querySelector('.txt_box');

                        // Get comments
                        const comments = [];
                        const commentElements = document.querySelectorAll('.comment-item, .comment-list li');

                        commentElements.forEach(commentElement => {
                            const author = commentElement.querySelector('.comment-nick')?.textContent.trim() || 'Unknown';
                            const content = commentElement.querySelector('.comment-text')?.textContent.trim() ||
                                          commentElement.querySelector('.comment-content')?.textContent.trim() || '';
                            const date = commentElement.querySelector('.comment-date')?.textContent.trim() || '';

                            if (content) {
                                comments.push({ author, content, date });
                            }
                        });

                        // Extract IRIS-specific keywords and categorize
                        const textContent = contentElement?.textContent || '';

                        return {
                            content: contentElement?.innerHTML || '',
                            plainText: textContent,
                            comments: comments,
                            wordCount: textContent.split(/\s+/).length
                        };
                    } catch (error) {
                        console.error('Error extracting post content:', error);
                        return {
                            content: '',
                            plainText: '',
                            comments: [],
                            wordCount: 0,
                            error: error.message
                        };
                    }
                });

                // Categorize post based on content
                const category = categorizePost(post.title, postContent.plainText);

                const detailedPost = {
                    ...post,
                    ...postContent,
                    category: category,
                    collectedAt: new Date().toISOString()
                };

                detailedPosts.push(detailedPost);
                processedCount++;

                console.log(`✅ Processed: ${post.title} (${category})`);

                await postPage.close();

                // Take a short break between posts
                await page.waitForTimeout(1000);

            } catch (error) {
                console.error(`❌ Error processing post "${post.title}":`, error.message);
                detailedPosts.push({
                    ...post,
                    content: '',
                    plainText: '',
                    comments: [],
                    category: 'error',
                    error: error.message,
                    collectedAt: new Date().toISOString()
                });
            }
        }

        // Step 6: Organize and save data
        console.log('📁 Organizing and saving data...');

        const organizedData = {
            metadata: {
                collectionDate: new Date().toISOString(),
                sourceUrl: irisBoardUrl,
                totalPostsFound: allPosts.length,
                postsProcessed: processedCount,
                collector: 'Playwright Automation'
            },
            summary: {
                byCategory: {},
                totalWordCount: 0,
                totalComments: 0
            },
            posts: detailedPosts
        };

        // Calculate summary statistics
        detailedPosts.forEach(post => {
            organizedData.summary.totalWordCount += post.wordCount || 0;
            organizedData.summary.totalComments += post.comments?.length || 0;

            const category = post.category || 'uncategorized';
            organizedData.summary.byCategory[category] = (organizedData.summary.byCategory[category] || 0) + 1;
        });

        // Save to JSON file
        const outputPath = path.join(outputDir, 'iris_cafe_posts.json');
        fs.writeFileSync(outputPath, JSON.stringify(organizedData, null, 2), 'utf8');

        // Also save a human-readable summary
        const summaryPath = path.join(outputDir, 'iris_summary.md');
        generateSummaryReport(organizedData, summaryPath);

        console.log(`✅ Collection complete!`);
        console.log(`📁 Data saved to: ${outputPath}`);
        console.log(`📊 Summary saved to: ${summaryPath}`);
        console.log(`📈 Processed ${processedCount} posts with ${organizedData.summary.totalComments} comments`);

    } catch (error) {
        console.error('❌ Error during collection:', error);

        // Take screenshot for debugging
        try {
            await page.screenshot({ path: path.join(outputDir, 'error_screenshot.png'), fullPage: true });
            console.log('📷 Error screenshot saved');
        } catch (screenshotError) {
            console.error('Could not save error screenshot:', screenshotError);
        }

        throw error;
    } finally {
        await browser.close();
    }
}

function categorizePost(title, content) {
    const text = (title + ' ' + content).toLowerCase();

    if (text.includes('설치') || text.includes('install') || text.includes('설정') || text.includes('setup')) {
        return 'installation';
    } else if (text.includes('명령어') || text.includes('command') || text.includes('커맨드') || text.includes('실행')) {
        return 'commands';
    } else if (text.includes('오류') || text.includes('error') || text.includes('문제') || text.includes('troubleshoot')) {
        return 'troubleshooting';
    } else if (text.includes('가이드') || text.includes('guide') || text.includes('사용법') || text.includes('howto')) {
        return 'guide';
    } else if (text.includes('업데이트') || text.includes('update') || text.includes('버전')) {
        return 'updates';
    } else if (text.includes('질문') || text.includes('question') || text.includes('문의')) {
        return 'qa';
    } else {
        return 'general';
    }
}

function generateSummaryReport(data, outputPath) {
    let report = `# IRIS Cafe Posts Collection Summary\n\n`;
    report += `**Collection Date:** ${new Date(data.metadata.collectionDate).toLocaleString()}\n`;
    report += `**Source:** ${data.metadata.sourceUrl}\n`;
    report += `**Total Posts Found:** ${data.metadata.totalPostsFound}\n`;
    report += `**Posts Processed:** ${data.metadata.postsProcessed}\n\n`;

    report += `## Statistics\n\n`;
    report += `- **Total Word Count:** ${data.summary.totalWordCount.toLocaleString()}\n`;
    report += `- **Total Comments:** ${data.summary.totalComments}\n\n`;

    report += `## Posts by Category\n\n`;
    Object.entries(data.summary.byCategory).forEach(([category, count]) => {
        report += `- **${category}:** ${count} posts\n`;
    });

    report += `\n## Recent Posts\n\n`;
    data.posts.slice(0, 10).forEach((post, index) => {
        report += `${index + 1}. **${post.title}** (${post.category})\n`;
        report += `   - Author: ${post.author}\n`;
        report += `   - Date: ${post.date}\n`;
        report += `   - Comments: ${post.comments?.length || 0}\n`;
        report += `   - Words: ${post.wordCount?.toLocaleString() || 0}\n\n`;
    });

    fs.writeFileSync(outputPath, report, 'utf8');
}

// Run the collection
collectIrisPosts().catch(console.error);