const { config, logger, redis } = require('../../../config')
const CraigslistListing = require('./craigslistListing.model')

const namespace = 'clippings-backend:craigslist:service'

async function transferDataOLD() {
    const today = new Date()
    const yesterday = new Date(new Date().setDate(today.getDate() - 1))

    const yesterdayEnd = new Date(yesterday.setHours(23, 59, 59, 999))

    try {
        const archives = await redis.HGETALL('archives')

        // Create an array to store the keys that have been successfully saved
        const savedArchives = []

        // Loop through the Redis fields
        for (const archive of Object.values(archives)) {
            const archiveObj = JSON.parse(archive)
            const { listingPid, createdAt } = archiveObj

            // Check if the field contains a valid 'createdAt' timestamp
            if (!isNaN(createdAt)) {
                const createdAtDate = new Date(createdAt)

                if (createdAtDate <= yesterdayEnd) {
                    // Save the document to MongoDB
                    listing = await CraigslistListing.findOneAndUpdate({ listingPid }, {
                        listingPid,
                        json: archive
                    }, { upsert: true, new: true, lean: true })
                    savedArchives.push(archiveObj)
                    console.log(`Saved Craigslist listing with createdAt: ${listingPid}`)
                }
            }
        }

        // Move saved keys from more active cache to less active
        await Promise.all(savedArchives.map(archive => {
            const multi = redis.multi()
            multi.HSET('archives-older', archive.listingPid, JSON.stringify(archive))
            multi.HDEL('archives', archive.listingPid)
            return multi.exec()
        }))

        return savedArchives.map(archive => ({ ...archive, url: `https://clippings.june07.com/archive/cl/${archive.listingPid}` }))
    } catch (error) {
        logger.error({ namespace, message: 'Error transferring data:', error })
    }
}
async function transferData() {
    const today = new Date()
    const yesterday = new Date(new Date().setDate(today.getDate() - 1))
    const yesterdayEnd = new Date(yesterday.setHours(23, 59, 59, 999))
    const savedArchives = []
    const batchSize = 100 // Tune this based on memory/performance
    let cursor = '0'

    try {
        do {
            const result = await redis.HSCAN('archives', cursor, { COUNT: batchSize })
            const [nextCursor, results] = [result.cursor, result.entries]
            cursor = nextCursor

            for (let i = 0; i < results.length; i += 1) {
                const { field: listingPid, value: archiveStr } = results[i]

                try {
                    const archiveObj = JSON.parse(archiveStr)
                    const createdAt = archiveObj?.createdAt

                    if (!isNaN(createdAt)) {
                        const createdAtDate = new Date(createdAt)

                        if (createdAtDate <= yesterdayEnd) {
                            // Save to MongoDB
                            await CraigslistListing.findOneAndUpdate(
                                { listingPid },
                                { listingPid, json: archiveStr },
                                { upsert: true, new: true, lean: true }
                            )

                            savedArchives.push(archiveObj)

                            // Move to older hash
                            const multi = redis.multi()

                            multi.HSET('archives-older', listingPid, archiveStr)
                            multi.HDEL('archives', listingPid)

                            await multi.exec()

                            console.log(`Saved and moved listing: ${listingPid}`)
                        }
                    }
                } catch (innerErr) {
                    logger.warn({ namespace, message: `Error processing archive ${results[i]}:`, error: innerErr })
                }
            }
        } while (cursor !== '0')

        if (!savedArchives.length) {
            logger.info({ namespace, message: 'No archives to transfer for yesterday.' })
            return []
        }

        return savedArchives.map(archive => ({
            ...archive,
            url: `https://clippings.june07.com/archive/cl/${archive.listingPid}`
        }))
    } catch (error) {
        logger.error({ namespace, message: 'Error transferring data:', error })
    }
}
function filterYesterdays(listings) {
    const today = new Date()
    const yesterday = new Date(new Date().setDate(today.getDate() - 1))

    const yesterdayStart = yesterday.setHours(0, 0, 0, 0)
    const yesterdayEnd = yesterday.setHours(23, 59, 59, 999)

    return listings?.filter(listing => {
        createdAtDate = new Date(listing.createdAt)

        if (createdAtDate >= yesterdayStart && createdAtDate < yesterdayEnd) {
            return listing
        }
    }) || []
}

if (config.NODE_ENV !== 'production') {
    global.transferData = transferData
}

module.exports = {
    transferData,
    filterYesterdays
}
