const fs = require('fs')
const { exec } = require('child_process')
const { promisify } = require('util')
const { glob } = require('glob')
const { until } = require('async')
const execAsync = promisify(exec)
const { EventEmitter } = require('events')
const { PlaywrightCrawler, Configuration } = require('crawlee')
const { BrowserName, DeviceCategory, OperatingSystemsName } = require('@crawlee/browser-pool')

const { config, logger, redis } = require('../../config')
const { githubService } = require('../github')
const { parserService } = require('../parser')
const requestHandler = require('./requestHandler')
const requestHandler2 = require('./requestHandler2')

const namespace = 'clippings-backend:crawler:worker'
const crawleeConfig = Configuration.getGlobalConfig()
crawleeConfig.set('logLevel', config.NODE_ENV === 'production' ? 'INFO' : 'DEBUG')
const {
    DOMAIN,
    TTL_SECONDS = 600,
    DISPLAY_OFFSET = 1, // display :1 for first session
    VNC_PORT_RANGE = { min: 5100, max: 5200 },
    WEB_PORT_RANGE = { min: 6100, max: 6200 },
    IMMEDIATE_CLEANUP = false,
    FILE_AGE_SECONDS = 60 * 10
} = process.env

class CrawlerWorker extends EventEmitter {
    constructor() {
        super()
        this.emitter = new EventEmitter()
        this.emitter.on('error', error => {
            addSetItem('errors', JSON.stringify(error), 500)
        })
        this.emitter.on('crawled', async payload => {
            const { clientId, listingURL, listingUUID, html, imageUrls, listingPid, detectedCaptcha, emailAddress } = payload

            // store data in git
            const gitUrl = await githubService.saveAdToPages({ url: listingURL, html, imageUrls })
            const recentListing = await toRecentListing(payload)
            if (config.NODE_ENV === 'production') await redis.HSET('archives', listingPid, JSON.stringify({
                createdAt: recentListing.createdAt,
                metadata: recentListing.metadata,
                ...payload
            }))
            addSetItem('recent_listings', JSON.stringify(recentListing), 10)
            this.emitter.emit('archived', { archived: { ...payload, gitUrl } })

            if (detectedCaptcha || !emailAddress) {
                logger.info(`Captcha detected or email missing, requeueing ${listingURL} for reCAPTCHA handling...`)

                const { display, webPort, vncPort } = await allocateVncAndWebPorts(listingPid)

                await launchX11Server({ display, vncPort, webPort, clientId })
                await redis.SET(`vnc:allocations-${clientId}`, JSON.stringify({ display, vncPort, webPort }), { EX: TTL_SECONDS })

                const vncUrl = `wss://${DOMAIN}/v1/vnc/${webPort}` // this is the noVNC URL

                // setup the x11 and x11vnc

                logger.info(`Requeueing ${listingURL} for reCAPTCHA handling on display ${display}...`)
                const headedCrawler = await launchHeadedCrawler(this.emitter, clientId, { display, listingURL })

                this.emitter.emit('vncReady', {
                    clientId,
                    url: vncUrl,
                    vncPort,
                })

                await run(headedCrawler, [`${listingUUID} ${listingURL}`], payload)
            }
        })
        this.emitter.on('re-crawled', async payload => {
            const { emailAddress, clientId, listingPid } = payload

            const cache = await redis.GET(`vnc:allocations-${clientId}`) || {}
            const { display, webPort, vncPort } = JSON.parse(cache)

            cleanupX11Server({ display, webPort, vncPort, clientId })
            deAllocateVncAndWebPorts(vncPort, webPort, display)

            if (emailAddress) {
                logger.info(`Got CL  ephemeral emailAddress: ${emailAddress}`)
                const today = new Date().toISOString().split('T')[0]

                await redis.SADD(`emails:${today}`, JSON.stringify({ listingPid, emailAddress }))
            }
            this.emitter.emit('vncFinished')
        })
        this.crawlers = {}
        this.testFunc = () => test()
    }
    async archive(options) {
        const { emitter, crawlers } = this
        const { listingURL, listingUUID, clientId } = options
        const isRunning = await redis.GET(`running-${listingUUID}`)

        if (!isRunning) {
            logger.debug({ namespace, message: 'crawling', listingUUID })
            // check to see if the user is at the maximum crawler limit first and wait for the next cycle, otherwise start a new crawl
            const userConfig = JSON.parse(await redis.HGET('userConfig', clientId))
            const numberOfCrawlers = await redis.ZSCORE(`crawlers`, clientId)

            await redis.SET(`running-${listingUUID}`, new Date().toLocaleString(), { EX: TTL_SECONDS })

            const multi = redis.multi()
            multi.HVALS(`queued`, clientId)
            multi.HKEYS(`queued`, clientId)
            const results = await multi.exec()
            const urls = Array.from(new Set([...results[0], `${listingUUID} ${listingURL}`])).filter(url => url)

            results[1].map(key => redis.HDEL(`queued`, key))

            if (!crawlers[clientId]) {
                crawlers[clientId] = await launchCrawler(emitter, clientId)
            } else if (!numberOfCrawlers || numberOfCrawlers < (userConfig?.crawlerLimit || 2)) {
                crawlers[clientId] = await launchCrawler(emitter, clientId)
            }
            run(crawlers[clientId], urls, options)
        } else {
            logger.debug({ namespace, message: `${new Date().toLocaleTimeString()}: queued clientId: ${clientId}` })
            redis.HSET(`queued`, clientId, `${listingUUID} ${listingURL}`)
        }
    }
}

module.exports = CrawlerWorker

async function test() {
    const listingURL = 'https://june07.com'
    const display = 99

    const crawler = new PlaywrightCrawler({
        launchContext: {
            launchOptions: {
                headless: false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    `--app=${listingURL}`,
                ],
                env: {
                    DISPLAY: `:${display}`,
                },
                // Optional: override with system Chrome path if needed
                // executablePath: '/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome'
            }
        },
        browserPoolOptions: {
            useFingerprints: true,
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
        requestHandlerTimeoutSecs: 120,
        maxRequestRetries: 0, // no retry here – user will solve CAPTCHA
        requestHandler: requestHandler2({ emitter: undefined, logger: {}, namespace: 'test' })
    })
    await crawler.run([{ url: listingURL, userData: { options: { vncConfig: { display } } } }])
}
async function addSetItem(setKey, item, maxSize) {
    const currentSize = await redis.SCARD(setKey)

    if (currentSize < maxSize) {
        await redis.SADD(setKey, item)
    } else {
        // Prune the Set by removing the first (oldest) member(s).
        const membersToRemove = currentSize - maxSize + 1
        for (let i = 0; i < membersToRemove; i++) {
            await redis.SPOP(setKey)
        }

        // Now, you can safely add the new item to the Set.
        await redis.SADD(setKey, item)
    }
}

async function toRecentListing(listing) {
    const { listingPid, html } = listing
    const metadata = await parserService.parseMetadata(html)

    return { listingPid, metadata, createdAt: Date.now() }
}
async function launchCrawler(emitter, clientId) {
    const crawler = new PlaywrightCrawler({
        launchContext: {
            useIncognitoPages: true,
            launchOptions: {
                args: [
                    '--no-zygote',
                    '--single-process',
                    '--remote-debugging-port=9222',
                    '--headless=new'
                ]
            }
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
        requestHandler: requestHandler({ emitter, logger, namespace })
    })
    redis.ZINCRBY(`crawlers`, 1, clientId)
    return crawler
}
async function launchHeadedCrawler(emitter, clientId, vncConfig) {
    const { display, listingURL } = vncConfig || {}
    const x11Auth = `/tmp/.Xauthority-${clientId}`

    try {
        const crawler = new PlaywrightCrawler({
            launchContext: {
                useIncognitoPages: true,
                launchOptions: {
                    headless: false,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-zygote',
                        '--single-process',
                        '--disable-gpu',
                        '--disable-software-rasterizer',
                        '--window-position=0,0',
                        '--window-size=1920,1080',
                        '--proxy-server=http://squid:3128',
                        `--app=${listingURL}`,
                    ],
                    env: {
                        DISPLAY: `:${display}`,
                        XAUTHORITY: x11Auth
                    }
                    // Optional: override with system Chrome path if needed
                    // executablePath: '/root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome'
                }
            },
            browserPoolOptions: {
                useFingerprints: true,
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
            requestHandlerTimeoutSecs: 60 * 5,
            maxRequestRetries: 0, // no retry here – user will solve CAPTCHA
            requestHandler: requestHandler2({ emitter, logger, namespace })
        })

        redis.ZINCRBY('crawlers', 1, clientId)
        return crawler
    } catch (error) {
        config.NODE_ENV === 'production' ? logger.error(error) : logger.debug({ namespace, message: error })
    }
}

async function run(crawler, urlMap, options) {
    const urls = urlMap.map(m => m.split(' ')[1])
    const uuids = urlMap.map(m => m.split(' ')[0])

    try {
        if (crawler.running) {
            crawler.addRequests(urls.map(url => ({ url, userData: { options } })))
        } else {
            await crawler.run(urls.map(url => ({ url, userData: { options } })))
            crawler.requestQueue.drop()
        }
    } catch (error) {
        config.NODE_ENV === 'production' ? logger.error(error) : logger.debug({ namespace, message: error })
    } finally {
        const multi = redis.multi()
        uuids.forEach(uuid => multi.DEL(`running-${uuid}`))
        multi.exec()
    }
}

process.on('SIGUSR2', async () => {
    const queuedKeys = await redis.KEYS(`queued-*`)
    const runningKeys = await redis.KEYS(`running-*`)

    await Promise.all([
        redis.ZREMRANGEBYRANK(`crawlers`, 0, -1),
        ...queuedKeys.map(key => redis.DEL(key)),
        ...runningKeys.map(key => redis.DEL(key))
    ])
})

async function deAllocateVncAndWebPorts(vncPort, webPort, display) {
    await redis.multi()
        .zRem('vnc:usedVncPorts', vncPort.toString())
        .zRem('vnc:usedWebPorts', webPort.toString())
        .zRem('vnc:usedDisplays', display.toString())
        .exec()
}

async function allocateVncAndWebPorts(clientId) {
    const allocationKey = 'vnc:allocations'
    const ttlKey = `vnc:session:${clientId}`

    // Reuse active session if TTL hasn't expired
    const existing = await redis.HGET(allocationKey, clientId)
    if (existing && await redis.EXISTS(ttlKey)) {
        return JSON.parse(existing)
    }

    // Clean up expired session if any
    if (existing) {
        const { vncPort, webPort, display } = JSON.parse(existing)
        await deAllocateVncAndWebPorts(vncPort, webPort, display)
        await redis.HDEL(allocationKey, clientId)
    }

    const usedVnc = await redis.ZRANGE('vnc:usedVncPorts', 0, -1)
    const usedWeb = await redis.ZRANGE('vnc:usedWebPorts', 0, -1)
    const usedDisplays = await redis.ZRANGE('vnc:usedDisplays', 0, -1)

    const vncPort = findAvailablePort(VNC_PORT_RANGE, usedVnc)
    const webPort = findAvailablePort(WEB_PORT_RANGE, usedWeb)
    const display = findAvailableDisplay(usedDisplays)

    if (!vncPort || !webPort || display == null) {
        throw new Error('No available ports or displays')
    }

    const allocation = { vncPort, webPort, display }

    await redis
        .multi()
        .hSet(allocationKey, clientId, JSON.stringify(allocation))
        .zAdd('vnc:usedVncPorts', { score: Date.now(), value: vncPort.toString() })
        .zAdd('vnc:usedWebPorts', { score: Date.now(), value: webPort.toString() })
        .zAdd('vnc:usedDisplays', { score: Date.now(), value: display.toString() })
        .set(ttlKey, '1', { EX: TTL_SECONDS })
        .exec()

    return allocation
}

function findAvailablePort(range, used) {
    for (let port = range.min; port <= range.max; port++) {
        if (!used.includes(String(port))) return port
    }
    return null
}

function findAvailableDisplay(used) {
    let d = DISPLAY_OFFSET
    while (used.includes(String(d))) {
        d++
        if (d > 99) return null
    }
    return d
}

async function launchX11Server({ display, vncPort, webPort, clientId }) {
    const x11Auth = `/tmp/.Xauthority-${clientId}`
    const x11Log = `/tmp/xvfb-${clientId}.log`
    const displayName = `:${display}`
    const resolution = '1920x1080x24'

    async function x11Ready() {
        await until(
            async () => {
                try {
                    await execAsync(`xdpyinfo -display ${displayName}`, {
                        env: {
                            XAUTHORITY: x11Auth
                        }
                    })
                    return true // X11 is ready
                } catch (err) {
                    return false // Try again
                }
            },
            async () => {
                await new Promise(resolve => setTimeout(resolve, 500)) // wait 500ms before retry
            }
        )
    }
    await execAsync(`touch ${x11Auth}`)
    await execAsync(`xauth -f ${x11Auth} add ${displayName} . $(mcookie)`)

    // 1. Start Xvfb
    const xvfbCmd = `Xvfb ${displayName} -screen 0 ${resolution} -auth ${x11Auth} > ${x11Log} 2>&1 &`
    console.log(`Starting X11 server for client ${clientId}: ${xvfbCmd}`)

    // 2. Start x11vnc
    const x11vncCmd = `x11vnc -display ${displayName} -auth ${x11Auth} -rfbport ${vncPort} -forever -nopw -shared > /tmp/x11vnc-${clientId}.log 2>&1 &`
    console.log(`Starting x11vnc for client ${clientId}: ${x11vncCmd}`)

    // 3. Start websockify (noVNC frontend)
    const websockifyCmd = `websockify ${webPort} localhost:${vncPort} > /tmp/websockify-${clientId}.log 2>&1 &`
    console.log(`Starting websockify for client ${clientId}: ${websockifyCmd}`)

    try {
        await execAsync(xvfbCmd)
        await execAsync(x11vncCmd)
        await execAsync(websockifyCmd)

        await x11Ready()
        console.log(`Started X11, x11vnc, and websockify for client ${clientId}`)
    } catch (err) {
        console.error(`Error launching X11 server stack:`, err)
        throw err
    }
}

async function cleanupX11Server({ display, vncPort, webPort, clientId }) {
    const x11Auth = `/tmp/.Xauthority-${clientId}`
    const x11Log = `/tmp/xvfb-${clientId}.log`
    const x11vncLog = `/tmp/x11vnc-${clientId}.log`
    const websockifyLog = `/tmp/websockify-${clientId}.log`

    const killCmds = [
        `pkill -f "Xvfb :${display}"`,
        `pkill -f "x11vnc -display :${display}"`,
        `pkill -f "websockify ${webPort} localhost:${vncPort}"`,
    ]

    for (const cmd of killCmds) {
        try {
            await execAsync(cmd)
        } catch (err) {
            if (err.code === 1) {
                // pkill returns 1 if no processes matched
                console.warn(`No matching process for: ${cmd}`)
            } else {
                console.warn(`Failed to execute: ${cmd}`, err.message)
            }
        }
    }

    const filesToRemove = [x11Auth, x11Log, x11vncLog, websockifyLog]

    if (IMMEDIATE_CLEANUP) {
        for (const file of filesToRemove) {
            try {
                await fs.promises.unlink(file)
            } catch (e) {
                if (e.code !== 'ENOENT') {
                    console.warn(`Could not remove file ${file}:`, e.message)
                }
            }
        }
    } else {
        logger.info('Time based cleanup of old files, to configure immediate cleanup set IMMEDIATE_CLEANUP to true')
        const patterns = [
            '/tmp/.Xauthority-*',
            '/tmp/xvfb-*.log',
            '/tmp/x11vnc-*.log',
            '/tmp/websockify-*.log'
        ]

        const now = Date.now()

        for (const pattern of patterns) {
            try {
                const files = await glob(pattern)

                for (const file of files) {
                    try {
                        const { mtime } = await stat(file)
                        const ageSeconds = (now - mtime.getTime()) / 1000

                        if (ageSeconds > FILE_AGE_SECONDS) {
                            await unlink(file)
                            console.log(`Removed old file: ${file}`)
                        } else {
                            console.log(`Skipped recent file: ${file} (${Math.round(ageSeconds)}s old)`)
                        }
                    } catch (err) {
                        if (err.code !== 'ENOENT') {
                            console.warn(`Could not stat/remove file ${file}:`, err.message)
                        }
                    }
                }
            } catch (globErr) {
                console.warn(`Failed to match files for pattern "${pattern}":`, globErr.message)
            }
        }
    }

    console.log(`Cleaned up X11 server for client ${clientId}`)
}
