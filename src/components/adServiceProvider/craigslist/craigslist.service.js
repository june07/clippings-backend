const redis = require('../../../config/redis')
const CraigslistListing = require('./craigslistListing.model')

async function transferData() {
    const yesterday = new Date()

    yesterday.setDate(yesterday.getDate() - 1)

    try {
        // Get all fields from the 'recent_listings' Redis HASH
        const redisFields = (await redis.SMEMBERS('recent_listings')).map(field => JSON.parse(field))

        // Create an array to store the keys that have been successfully saved
        const savedKeys = []

        // Loop through the Redis fields
        for (const field in redisFields) {
            const { listingPid, createdAt, metadata } = redisFields[field]

            // Check if the field contains a valid 'createdAt' timestamp
            if (!isNaN(createdAt)) {
                const createdAtDate = new Date(createdAt)

                if (createdAtDate <= yesterday) {
                    // Create a new CraigslistListing document
                    const metadataString = JSON.stringify(metadata)
                    delete redisFields[field].metadata

                    // Save the document to MongoDB
                    listing = await CraigslistListing.findOneAndUpdate({ listingPid }, {
                        metadata: metadataString,
                        ...redisFields[field]
                    }, { upsert: true, new: true, lean: true })
                    savedKeys.push(field)
                    console.log(`Saved Craigslist listing with createdAt: ${listingPid}`)
                }
            }
        }

        // Remove successfully saved keys from Redis
        if (savedKeys.length > 0) {
            await redis.HDEL('recent_listings', ...savedKeys)
            console.log(`Removed saved keys from Redis: ${savedKeys}`)
        }
        return redisFields.map(ad => ({ ...ad, url: `https://clippings-archive.june07.com/craigslist/${ad.pid}` }))
    } catch (error) {
        console.error('Error transferring data:', error)
    }
}
function filterYesterdays(listings) {
    const today = new Date()
    const yesterday = new Date(new Date().setDate(today.getDate() - 1))

    const yesterdayStart = yesterday.setHours(0, 0, 0, 0)
    const yesterdayEnd = yesterday.setHours(23, 59, 59, 999);

    return listings.filter(listing => {
        createdAtDate = new Date(listing.createdAt)
        
        if (createdAtDate >= yesterdayStart && createdAtDate < yesterdayEnd) {
            return listing
        }
    })
}

module.exports = {
    transferData,
    filterYesterdays
}
