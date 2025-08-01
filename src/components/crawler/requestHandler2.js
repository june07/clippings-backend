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

    log.info(`Re-crawling ${request.url}...`)

    await page.setViewportSize({ width: 1920, height: 1080 })

    let emailAddress, detectedCaptcha = false

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
            // wait for the captcha to be solved
            await page.waitForSelector('.g-recaptcha')
        } catch (err) {
            log.info('No captcha iframe detected within timeout.')
        }
    }

    log.info(JSON.stringify({ url: request.url }, null, 4))
    logger.debug({ namespace, message: JSON.stringify({ url: request.url }) })

    emitter.emit('re-crawled', { emailAddress, url: request.url, ...options, detectedCaptcha })

    await page.close()
}
