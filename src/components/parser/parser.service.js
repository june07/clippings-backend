const debug = require('debug')(`jc-backend:parser:service`)
const cheerio = require('cheerio')
const { map } = require('async')
const { v5: uuidv5 } = require('uuid')

const { estimateTimestampFromRelativeTime } = require('../../utils')
const { githubService } = require('../github')
const crawlerService = require('../crawler/crawler.service')

const parseMetadata = async (html) => {
    const $ = cheerio.load(html)
    const title = $('title').text()
    const metadata = {
        title
    }
    return metadata
}
const parse = async (payload, redis) => {
    const { url, uuid, html } = payload
    const $ = cheerio.load(html)
    const $searchResults = $('li.cl-search-result')
    let json = {
        url,
        uuid,
        listings: {}
    }
    let cached = await redis.GET(`cl-json-${uuid}`)
    let diff = cached ? true : false

    $searchResults.each((_index, element) => {
        const pid = $(element).attr('data-pid')
        const href = $(element).find('.posting-title').attr('href')
        const listingUUID = uuidv5(href, uuidv5.URL)
        const title = $(element).find('.cl-app-anchor .label').text()
        const meta = $(element).find('.meta').text().split($(element).find('.separator').text())

        if (!pid || !title) return
        if (!json.listings[listingUUID]) {
            json.listings[listingUUID] = {
                pid,
                imageUrls: []
            }
        }

        $(element).find('.gallery-inner img').each((_index, element) => {
            const imageUrl = $(element).attr('src')
            if (imageUrl) {
                json.listings[listingUUID].imageUrls = Array.from(new Set([...json.listings[listingUUID].imageUrls, imageUrl]))
            }
        })
        json.listings[listingUUID].href = href
        json.listings[listingUUID].title = title
        json.listings[listingUUID].meta = meta
        json.listings[listingUUID].time = estimateTimestampFromRelativeTime(json.listings[listingUUID].meta[0])
    })
    json.updatedAt = Date.now()

    if (diff) {
        cached = JSON.parse(cached)
        const newListings = Object.keys(json.listings).filter(key => !cached.listings[key]).reduce((listings, key) => ({ ...listings, [key]: json.listings[key] }), {})

        diff = {}
        if (JSON.stringify(newListings) !== '{}') {
            const multi = redis.multi()
            diff = {
                ...json,
                updatedAt: Date.now(),
                listings: newListings
            }

            multi.SET(`cl-json-${uuid}`, JSON.stringify({
                ...cached,
                ...json
            }))
            multi.SET(`cl-json-diff-${uuid}`, JSON.stringify(diff))
            multi.exec()
        }
    } else {
        redis.SET(`cl-json-${uuid}`, JSON.stringify(json))
    }
    const multi = redis.multi()
    multi.HGETALL('commented')
    multi.HKEYS('archives')
    //multi.DEL('commented')
    const updateComments = (await multi.exec())[0]
    const updateCommentsArr = Object.keys(updateComments) || []
    const archivesUUIDsArr = (await multi.exec())[1]
    const promises = []
    if (updateCommentsArr.length) {
        // update the cached listings with comment data
        const listingsArr = Object.values(json.listings).filter(listing => updateCommentsArr.find(key => key === listing.uuid))
        if (listingsArr.length) {
            promises.push(
                map(listingsArr, async listing => {
                    if (listing.commentData || await redis.HGET('commented', listing.uuid)) {
                        // all listings that are commented on should automatically be archived
                        if (listing.commentData?.comments?.totalCount === 1 && !listing.archived) {
                            const { url, uuid } = listing

                            crawlerService.archive({ url, uuid, clientId: 'system' })
                        }
                        json.listings[listing.uuid].commentData = await githubService.getCommentData(listing.uuid)
                    }
                })
            )
        }
    }
    if (archivesUUIDsArr.length) {
        promises.push(
            map(archivesUUIDsArr, async archiveUUID => {
                if (json.listings[archiveUUID]) {
                    json.listings[archiveUUID].archived = true
                }
            })
        )
    }
    if (promises.length) {
        await Promise.all(promises)
        redis.SET(`cl-json-${uuid}`, JSON.stringify(json))
    }
    return Object.fromEntries(Object.entries({ json, diff }).filter(([_key, value]) => value !== undefined))
}

module.exports = {
    parse,
    parseMetadata
}