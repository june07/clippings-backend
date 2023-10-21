const redis = require('../../config/redis')
const { CraigslistListingModel } = require('../adServiceProvider/craigslist')

async function getArchivedAd(listingPid) {
    let archive = await redis.HGET('archives', `${listingPid}`)

    if (!archive) {
        // get it from mongoose and maybe move it back to archives or a different cache?!
        archive = await redis.HGET('archives-older', `${listingPid}`)
    }
    if (archive) {
        archive = JSON.parse(archive)
    } else {
        // get it from mongoose and maybe move it back to archives or a different cache?!
        archive = await CraigslistListingModel.findOne({ listingPid }, { __v: 0 }, { lean: true })
    }
    return archive
}

module.exports = {
    getArchivedAd
}