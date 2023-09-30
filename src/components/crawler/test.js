// For more information, see https://crawlee.dev/
import { PlaywrightCrawler, Configuration, sleep } from 'crawlee'
import { BrowserName, DeviceCategory, OperatingSystemsName } from '@crawlee/browser-pool'

const config = Configuration.getGlobalConfig()
config.set('logLevel', 'DEBUG')

export default async (url) => {
    let data = {}

    const crawler = new PlaywrightCrawler({
        launchContext: {
            useIncognitoPages: true
        },
        browserPoolOptions: {
            useFingerprints: true, // this is the default
            fingerprintOptions: {
                fingerprintGeneratorOptions: {
                    browsers: [{
                        name: BrowserName.edge,
                        minVersion: 96,
                    }],
                    devices: [
                        DeviceCategory.desktop,
                    ],
                    operatingSystems: [
                        OperatingSystemsName.windows,
                    ],
                },
            },
        },
        requestHandlerTimeoutSecs: 60,
        maxRequestRetries: 1,
        // Use the requestHandler to process each of the crawled pages.
        async requestHandler({ request, page, log }) {
            log.info(`Processing ${request.url}...`)
            await Promise.all([
                page.waitForLoadState('networkidle'),
                page.waitForLoadState('domcontentloaded'),
                page.waitForLoadState('load')
            ])

            const gallery = await page.$('.gallery .swipe')
            await gallery.hover()
            await gallery.click()
            await page.waitForSelector('.gallery.big')

            const imageUrls = await page.evaluate(() => {
                const imageElements = document.querySelectorAll('.gallery.big .slide img')
                const urls = []

                // Loop through the image elements and extract the 'src' attribute
                imageElements.forEach((img) => {
                    const url = img.getAttribute('src')
                    urls.push(url)
                })

                return urls
            })

            const html = await page.content()

            console.log({ url: request.url, imageUrls, html })
            await page.screenshot({ path: `/tmp/screenshot.png` })
            await page.close()
        }
    })
    await crawler.run([url])
    return data
}
