const { mapSeries } = require('async')
const { Octokit } = require("@octokit/rest")

const { logger } = require('../../config')

const { GITHUB_USER, GITHUB_REPO, GITHUB_TOKEN, DOMAIN } = process.env
const namespace = 'jc-backend:github:service'

async function downloadImage(url) {
    try {
        const gotScraping = await import('got-scraping')
        const response = await gotScraping.got(url, { responseType: 'buffer' })

        // Check if the response status code indicates success (e.g., 200)
        if (response.statusCode === 200) {
            return Buffer.from(response.body).toString('base64')
        } else {
            console.error(`Failed to download image. Status code: ${response.statusCode}`)
            return null
        }
    } catch (error) {
        console.error(`Error downloading image: ${error.message}`)
        return null
    }
}
async function saveAdToPages(options) {
    const { url, html, imageUrls } = options
    const pid = url.match(/\/([^\/]*)\.html/)[1]
    const octokit = new Octokit({
        auth: GITHUB_TOKEN,
    })
    const subdir = `${pid}`
    const indexHTMLHead = `
<!DOCTYPE html>
<html>
    <head>
        <title>Archived content listing of ${url}</title>
        <link type="text/css" rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lightgallery@2.7.1/css/lightgallery-bundle.min.css" />
    </head>
    <body>
        <h2>Archived content listing of ${url}</h2>`
    let indexHTMLListItems = '', indexHTMLLightGalleryItems = ''
    const indexHTMLFoot = `
        <script src="https://cdn.jsdelivr.net/npm/lightgallery@2.7.1/lightgallery.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/lightgallery@2/plugins/thumbnail/lg-thumbnail.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/lightgallery@2/plugins/zoom/lg-zoom.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/lightgallery@2/plugins/share/lg-share.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/lightgallery@2/plugins/rotate/lg-rotate.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/lightgallery@2/plugins/fullscreen/lg-fullscreen.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/lightgallery@2/plugins/hash/lg-hash.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/lightgallery@2/plugins/comment/lg-comment.min.js"></script>
        <script type="text/javascript">
            lightGallery(document.getElementById('lightgallery'), {
                plugins: [lgZoom, lgThumbnail, lgShare, lgRotate, lgFullscreen, lgHash, lgComment],
            })
        </script>
        <script src="https://giscus.app/client.js"
            data-repo="june07/clippings-comments"
            data-repo-id="R_kgDOKZ-3jA"
            data-category="Announcements"
            data-category-id="DIC_kwDOKZ-3jM4CZvZb"
            data-mapping="specific"
            data-term="${pid}"
            data-strict="0"
            data-reactions-enabled="1"
            data-emit-metadata="0"
            data-input-position="bottom"
            data-theme="preferred_color_scheme"
            data-lang="en"
            crossorigin="anonymous"
            async>
        </script>
</script>
    </body>
</html>`
    try {
        await octokit.repos.createOrUpdateFileContents({
            owner: GITHUB_USER,
            repo: GITHUB_REPO,
            path: `craigslist/${subdir}/${pid}.html`,
            message: `Craigslist ad archived via JC by June07`,
            content: Buffer.from(html).toString('base64'),
            committer: {
                name: GITHUB_USER,
                email: `support@${DOMAIN}`
            }
        })
    } catch (error) {
        logger.error({ namespace, message: error.message })
    }
    await mapSeries(imageUrls, async url => {
        const content = await downloadImage(url)
        const filenameBigImage = url.split('/').pop()
        const path = `craigslist/${subdir}/${filenameBigImage}`

        indexHTMLListItems += `<li><a href="${filenameBigImage}">${filenameBigImage}</a></li>`
        indexHTMLLightGalleryItems += `<a href="${filenameBigImage}"><img height="150" width="150" src="${filenameBigImage}" /></a>`
        if (content) {
            try {
                await octokit.repos.createOrUpdateFileContents({
                    owner: GITHUB_USER,
                    repo: GITHUB_REPO,
                    path,
                    message: `Craigslist ad image archived via JC by June07`,
                    content: content,
                    committer: {
                        name: GITHUB_USER,
                        email: `support@${DOMAIN}`
                    }
                })
            } catch (error) {
                logger.error({ namespace, message: error.message })
            }
        }
    })
    const indexHTML = `${indexHTMLHead}
        <ul>
            <li><a href="${pid}.html">${pid}.html</a></li>
            ${indexHTMLListItems}
        </ul>
        <div id="lightgallery">
            ${indexHTMLLightGalleryItems}
        </div>
        <div class="iframe-wrapper" style="height: 500px">
            <iframe src="${pid}.html" style="
                width: 100%;
                height: 100%;
                border: none;
                zoom: 0.70;
                -moz-transform: scale(0.70);
                -moz-transform-origin: 0 0;
                -o-transform: scale(0.70);
                -o-transform-origin: 0 0;
                -webkit-transform: scale(0.70);
                -webkit-transform-origin: 0 0;
            "></iframe>
        </div>
        ${indexHTMLFoot}`

    try {
        await octokit.repos.createOrUpdateFileContents({
            owner: GITHUB_USER,
            repo: GITHUB_REPO,
            path: `craigslist/${subdir}/index.htm`,
            message: `Craigslist ad archived via JC by June07`,
            content: Buffer.from(indexHTML).toString('base64'),
            committer: {
                name: GITHUB_USER,
                email: `support@${DOMAIN}`
            }
        })
    } catch (error) {
        logger.error({ namespace, message: error.message })
    }
    return `https://clippings-archive.june07.com/craigslist/${subdir}/index.htm`
}
async function getCommentData(id) {
    const { got } = await import('got')
    const query = `
        query {
            search(type: DISCUSSION, last: 1, query: "repo:june07/clippings-comments in:id:${id}") {
                nodes {
                    ... on Discussion {
                        title
                        comments {
                            totalCount
                        }
                    }
                }
            }
        }
    `
    const { error, data } = await got({
        method: 'POST',
        url: 'http://api.github.com/graphql',
        headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`
        },
        body: JSON.stringify({ query })
    }).json()
    if (error) {
        logger.error(error)
        return
    }
    return data?.search?.nodes?.[0]
}

module.exports = {
    saveAdToPages,
    getCommentData
}