const { NODE_ENV } = process.env

module.exports = ({ emitter, logger, namespace }) => async function workerRequestHandler({ request, response, page, log }) {
    if (!response.ok()) {
        emitter.emit(
            'error',
            new Error(response.statusText(), {
                cause: {
                    request: {
                        url: request.url,
                    },
                    response: {
                        status: response.status(),
                    },
                },
            })
        )
        await page.close()
        return
    }

    const { options } = request.userData

    log.info(`Archiving ${request.url}...`)

    const html = await page.content()
    const gallery = await page.$('.gallery .swipe')
    const imageUrls = []
    let emailAddress, detectedCaptcha = false

    /** skip images in dev */
    if (NODE_ENV === 'production') {
        log.info(`Processing image urls for ${request.url}...`)

        await gallery.hover()
        await gallery.click()
        await page.waitForSelector('.gallery.big')

        imageUrls.push(
            await page.evaluate(() => {
                const imageElements = document.querySelectorAll('.gallery.big .slide img')
                const urls = []

                // Loop through the image elements and extract the 'src' attribute
                imageElements.forEach(img => {
                    const url = img.getAttribute('src')
                    urls.push(url)
                })

                return urls
            })
        )

        try {
            await page.waitForSelector('.lbclose')

            // Add a human-like delay before closing
            const delay = 500 + Math.random() * 1500  // between 500ms and 2000ms
            log.info(`Waiting ${Math.round(delay)}ms before closing lightbox...`)
            await page.waitForTimeout(delay)

            await page.click('.lbclose')
        } catch (error) {
            log.info('No lightbox close button detected within timeout.')
        }

        log.info(`Processed image urls for ${request.url}...`)
    }

    try {
        log.info(`Processing reply button for ${request.url}...`)

        const replyButton = await page.waitForSelector('.reply-button')

        await replyButton.hover()
        await replyButton.click()

        const replyOptionsButton = await page.waitForSelector('.reply-option-header')

        if (replyOptionsButton) {
            await replyOptionsButton.click()

            const emailLink = await page.waitForSelector('.reply-email-address > a')
            emailAddress = await emailLink?.getAttribute('href')
        }

        log.info(`Processed reply button for ${request.url}...`)
    } catch (error) {
        log.info('Might have detected a captcha...')
        try {
            for (const frame of page.frames()) {
                const hcaptchaFrame = await frame.$('iframe[src*="hcaptcha.com/captcha"]')

                if (hcaptchaFrame) {
                    log.info(`Detected captcha in frame: ${frame.url()}`)
                    detectedCaptcha = true
                    break
                }
            }
        } catch (err) {
            log.info('No captcha iframe detected within timeout.')
        }
    }

    log.info(JSON.stringify({ url: request.url, imageUrls: imageUrls.flat() }, null, 4))
    logger.debug({ namespace, message: JSON.stringify({ url: request.url, imageUrls: imageUrls.flat() }) })

    const buffer = await page.screenshot()

    emitter.emit('screenshot', { buffer, uuid: options.listingUUID })

    await page.close()

    emitter.emit('crawled', { emailAddress, url: request.url, html, imageUrls: Array.from(new Set(imageUrls.flat())), ...options, detectedCaptcha })
}
