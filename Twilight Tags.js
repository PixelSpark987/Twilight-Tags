// ==UserScript==
// @name         Twilight Tags
// @namespace    http://tampermonkey.net/
// @version      9.0
// @description  Fetches tags, source URL, stats, original description, and direct images from Philomena-based boorus
// @author       PixelSpark987
// @icon         https://cdn.twibooru.org/favicon.svg
// @match        https://derpibooru.org/*
// @match        https://manebooru.art/*
// @match        https://ponerpics.org/*
// @match        https://ponybooru.org/*
// @match        https://tantabus.ai/*
// @match        https://twibooru.org/*
// @grant        GM_xmlhttpRequest
// @connect      derpibooru.org
// @connect      manebooru.art
// @connect      ponerpics.org
// @connect      denybooru.org
// @connect      ponybooru.org
// @connect      tantabus.ai
// @connect      twibooru.org
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // CONFIGURATION SECTION
    // ==========================================
    const CONFIG = {
        // UI Colours
        COLOR_INPUT_PLACEHOLDER: '#aaaaaa',
        COLOR_INPUT_ERROR_PLACEHOLDER: '#FF0000',
        COLOR_INPUT_BG: '#222222',
        COLOR_INPUT_TEXT: '#ffffff',
        COLOR_INPUT_BORDER: '#555555',

        COLOR_BUTTON_BG: '#550055',
        COLOR_BUTTON_BORDER: '#FF00FF',
        COLOR_BUTTON_TEXT: '#FFFFFF',

        COLOR_CHECK_BG: '#b8860b',
        COLOR_CHECK_BORDER: '#ffd700',
        COLOR_CHECK_TEXT: '#ffffff',

        COLOR_MATCH_BG: '#006400',
        COLOR_MATCH_BORDER: '#00ff00',

        COLOR_NOMATCH_BG: '#8b0000',
        COLOR_NOMATCH_BORDER: '#ff4500',

        // Button Labels
        TEXT_BUTTON_FETCH: 'Fetch Tags',
        TEXT_BUTTON_FETCHING: 'Fetching...',
        TEXT_BUTTON_CHECK: 'Check Posts',
        TEXT_BUTTON_CHECKING: 'Checking...',
        TEXT_BUTTON_MATCHES: 'Matches Found',
        TEXT_BUTTON_NO_MATCHES: 'No Matches Found',

        // Placeholders & Messages
        TEXT_PLACEHOLDER_INPUT: 'Paste a post URL',
        TEXT_ERROR_INVALID_URL: 'Invalid URL',
        TEXT_ERROR_SAME_HOST: 'Same Host',
        TEXT_ERROR_ALREADY_EXISTS: 'Image already exists',
        TEXT_ERROR_AI_NOT_ALLOWED: 'AI Not Allowed',

        // AI Detection Terms (for Derpibooru imports)
        AI_TAG_KEYWORDS: [
            'ai generated',
            'ai content',
            'ai art',
            'stable diffusion',
            'novelai',
            'midjourney',
            'dall-e',
            'dalle',
            'flux.1',
            'comfyui',
            'webui'
        ]
    };
    // ==========================================

    const plainInputSelector = '#image_tag_input';
    const fancyInputSelector = '#taginput-fancy-tag_input';
    const sourceUrlSelector = '#image_source_url, #source-form input[type="url"], input[name="post[sources][]"], input[name*="source"], input[placeholder*="Source"]';
    const descriptionSelector = '#image_description, textarea[name*="description"], textarea[placeholder*="Description"]';
    const fetchUrlSelector = '#image_scraper_url, #scraper_url, #image_bare_image_url, #image_fetch_url, input[name*="scraper_url"], input[name*="bare_image_url"], input[name*="fetch_url"], input[placeholder*="deviantART"], input[placeholder*="image directly"], input[placeholder*="Fetch"]';
    const fileInputSelector = '#image_image, #image_file, input[type="file"][name*="image"]';
    const nativeFetchButtonSelector = '#js-scraper-preview, button[data-disable-with="Fetch"], button[title*="Fetch"]';

    const SUPPORTED_SITES = [
        { domain: 'derpibooru.org', name: 'Derpibooru', hasImagesPath: true },
        { domain: 'manebooru.art', name: 'Manebooru', hasImagesPath: true },
        { domain: 'ponerpics.org', name: 'Ponerpics', hasImagesPath: true },
        { domain: 'ponybooru.org', name: 'Ponybooru', hasImagesPath: true },
        { domain: 'tantabus.ai', name: 'Tantabus', hasImagesPath: true },
        { domain: 'twibooru.org', name: 'Twibooru', hasImagesPath: false }
    ];

    let errorTimeout = null;
    let fetchedTagsStore = [];
    let fetchedMetadataTagsStore = [];
    let fetchedImageUrlStore = '';

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #twilight-tags-input::placeholder {
                color: ${CONFIG.COLOR_INPUT_PLACEHOLDER};
                transition: color 0.3s ease;
            }
            #twilight-tags-input.error-placeholder::placeholder {
                color: ${CONFIG.COLOR_INPUT_ERROR_PLACEHOLDER} !important;
            }
        `;
        document.head.appendChild(style);
    }

    function parseSiteUrl(rawInput) {
        if (!rawInput) return null;
        const trimmed = rawInput.trim();

        for (const site of SUPPORTED_SITES) {
            const domainEscaped = site.domain.replace('.', '\\.');
            const regex = new RegExp(`(?:${domainEscaped}\\/(?:images|posts)?\\/|${domainEscaped}\\/)(\\d+)`, 'i');
            const match = trimmed.match(regex);

            if (match) {
                const pathPrefix = site.hasImagesPath ? 'images/' : '';
                return {
                    siteName: site.name,
                    domain: site.domain,
                    imageId: match[1],
                    fullUrl: `https://${site.domain}/${pathPrefix}${match[1]}`
                };
            }
        }
        return null;
    }

    function clearAllFormInputs() {
        const inputsToClear = [
            plainInputSelector,
            fancyInputSelector,
            sourceUrlSelector,
            descriptionSelector,
            fetchUrlSelector
        ];

        inputsToClear.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                el.value = '';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            });
        });
    }

    function triggerErrorUI(inputEl, message, shouldClearInputs = false) {
        if (shouldClearInputs) {
            clearAllFormInputs();
        }

        inputEl.value = '';
        inputEl.placeholder = message;
        inputEl.classList.add('error-placeholder');

        if (errorTimeout) clearTimeout(errorTimeout);

        errorTimeout = setTimeout(() => {
            inputEl.placeholder = CONFIG.TEXT_PLACEHOLDER_INPUT;
            inputEl.classList.remove('error-placeholder');
        }, 4000);
    }

    function getCurrentSite() {
        const hostname = window.location.hostname.toLowerCase();
        return SUPPORTED_SITES.find(site => hostname.includes(site.domain.toLowerCase())) || null;
    }

    function fillSourceUrl(fullUrl) {
        const applyValue = () => {
            const sourceInputs = document.querySelectorAll(sourceUrlSelector);
            sourceInputs.forEach(input => {
                if (input.value.trim() !== fullUrl) {
                    input.value = fullUrl;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
        };

        applyValue();

        const intervalId = setInterval(applyValue, 200);
        setTimeout(() => clearInterval(intervalId), 4000);
    }

    function getFormattedUtcTimestamp() {
        const now = new Date();
        const year = now.getUTCFullYear();
        const month = String(now.getUTCMonth() + 1).padStart(2, '0');
        const day = String(now.getUTCDate()).padStart(2, '0');
        const hours = String(now.getUTCHours()).padStart(2, '0');
        const minutes = String(now.getUTCMinutes()).padStart(2, '0');
        const seconds = String(now.getUTCSeconds()).padStart(2, '0');

        return `${year}-${month}-${day} - ${hours}:${minutes}:${seconds} UTC`;
    }

    function htmlToMarkdown(element) {
        if (!element) return '';

        const clone = element.cloneNode(true);

        const headerNode = clone.querySelector('.block__header');
        if (headerNode) headerNode.remove();

        function parseNode(node) {
            if (node.nodeType === 3) {
                return node.nodeValue;
            }

            if (node.nodeType !== 1) {
                return '';
            }

            const tagName = node.tagName.toUpperCase();
            let childrenText = Array.from(node.childNodes).map(parseNode).join('');

            switch (tagName) {
                case 'A': {
                    const href = node.getAttribute('href');
                    const text = childrenText.trim();
                    if (!href || !text) return childrenText;
                    return `[${text}](${href})`;
                }
                case 'B':
                case 'STRONG':
                    return childrenText.trim() ? `**${childrenText.trim()}**` : '';
                case 'I':
                case 'EM':
                    return childrenText.trim() ? `*${childrenText.trim()}*` : '';
                case 'S':
                case 'DEL':
                    return childrenText.trim() ? `~~${childrenText.trim()}~~` : '';
                case 'BR':
                    return '\n';
                case 'P':
                case 'DIV': {
                    const text = childrenText.trim();
                    return text ? `${text}\n\n` : '';
                }
                case 'BLOCKQUOTE':
                    return childrenText.trim();
                case 'CODE':
                    return childrenText.trim();
                default:
                    return childrenText;
            }
        }

        let markdown = parseNode(clone);
        markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
        return markdown;
    }

    function extractStatsAndDescription(doc, siteDomain) {
        const favorites = doc.querySelector('.favorites, .interaction--fave .favorites')?.textContent?.trim() || '0';
        const upvotes = doc.querySelector('.upvotes, .interaction--upvote .upvotes')?.textContent?.trim() || '0';
        const score = doc.querySelector('.score')?.textContent?.trim() || '0';
        const downvotes = doc.querySelector('.downvotes, .interaction--downvote .downvotes')?.textContent?.trim() || '0';

        const commentsElem = doc.querySelector('.comments-count, #comments_count, [data-comments-count]');
        let comments = '0';
        if (commentsElem) {
            comments = commentsElem.textContent.replace(/[^0-9]/g, '').trim() || '0';
        } else {
            const commentBlocks = doc.querySelectorAll('.comment, .js-comment');
            if (commentBlocks.length > 0) {
                comments = String(commentBlocks.length);
            }
        }

        let uploaderName = 'Anonymous';
        let uploaderUrl = '';

        const uploaderLinkElem = doc.querySelector('.image-metabar .uploader a, .image-metabar .image_uploader a, .image-metabar a[href*="/profiles/"], .image-show-container .uploader a, .js-uploader-name');

        if (uploaderLinkElem) {
            uploaderName = uploaderLinkElem.textContent.trim();
            const rawHref = uploaderLinkElem.getAttribute('href');
            if (rawHref) {
                try {
                    uploaderUrl = new URL(rawHref, `https://${siteDomain}`).href;
                } catch (e) {
                    uploaderUrl = '';
                }
            }
        } else {
            const rawUploaderContainer = doc.querySelector('.image-metabar .image_uploader, .image-metabar .uploader, .js-uploader');
            if (rawUploaderContainer) {
                const rawText = rawUploaderContainer.textContent.trim();
                uploaderName = rawText.replace(/^(uploaded\s+by|by)\s*/i, '').trim();
            }
        }

        let rawDesc = '';
        const descContainer = doc.querySelector('.image-description__text, .image-description .block__content, .image-description, #description, .js-post-description');

        if (descContainer) {
            const contentArea = descContainer.querySelector('.block__content, .markdown-container') || descContainer;
            rawDesc = htmlToMarkdown(contentArea);
        }

        return {
            stats: { favorites, upvotes, score, downvotes, comments },
            uploaderName,
            uploaderUrl,
            originalDescription: rawDesc
        };
    }

    function fillDescription(siteInfo, statsData, rawFetchUrl) {
        const descInput = document.querySelector(descriptionSelector);
        if (!descInput) return;

        const { stats, uploaderName, uploaderUrl, originalDescription } = statsData;
        const currentSite = getCurrentSite();
        const currentDomain = currentSite ? currentSite.domain : window.location.hostname;

        const cleanFetchUrl = rawFetchUrl.split('?')[0];

        const isBackgroundPony = !uploaderName || /^Background Pony #[0-9a-fA-F]+$/i.test(uploaderName) || uploaderName.toLowerCase().includes('anonymous');
        let uploaderFormatted = uploaderName || 'Anonymous';

        if (!isBackgroundPony) {
            const originProfileUrl = uploaderUrl || `https://${siteInfo.domain}/profiles/${encodeURIComponent(uploaderName)}`;
            const targetBooruProfileUrl = `https://${currentDomain}/profiles/${encodeURIComponent(uploaderName)}`;
            uploaderFormatted = `[${uploaderName}](${originProfileUrl}) - ([here](${targetBooruProfileUrl}))`;
        }

        const utcTimestamp = getFormattedUtcTimestamp();
        const sitePostLink = `[${siteInfo.siteName} - ${siteInfo.imageId}](${cleanFetchUrl})`;

        let formattedOutput =
            `**Twilight Tags - Stats**\n` +
            `**Imported at:** ${utcTimestamp}\n` +
            `***\n` +
            `**Original Image Stats**\n` +
            `**Uploaded by:** ${uploaderFormatted}\n` +
            `**Favourites:** ${stats.favorites}\n` +
            `**Upvotes:** ${stats.upvotes}\n` +
            `**Score:** ${stats.score}\n` +
            `**Downvotes:** ${stats.downvotes}\n` +
            `**Comments:** ${stats.comments}\n` +
            `***\n`;

        if (originalDescription) {
            formattedOutput +=
                `**Original Description:**\n` +
                `${originalDescription}\n` +
                `***\n`;
        }

        formattedOutput +=
            `Image imported from ${sitePostLink}\n` +
            `Imported with [Twilight Tags](https://github.com/PixelSpark987/Twilight-Tags)`;

        descInput.value = formattedOutput;
        descInput.dispatchEvent(new Event('input', { bubbles: true }));
        descInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function extractDirectImageUrl(doc, baseUrl) {
        const allLinks = Array.from(doc.querySelectorAll('a'));

        let targetLink = allLinks.find(a => /^\s*(VS|DS)\s*$/i.test(a.textContent.trim()));

        if (!targetLink) {
            targetLink = allLinks.find(a => a.hasAttribute('data-download-uri')) ||
                         allLinks.find(a => a.href && (a.href.includes('/img/view/') || a.href.includes('/img/download/')));
        }

        if (targetLink) {
            const rawUrl = targetLink.getAttribute('data-download-uri') || targetLink.getAttribute('href');
            if (rawUrl) {
                try {
                    return new URL(rawUrl, baseUrl).href;
                } catch (e) {
                    return null;
                }
            }
        }
        return null;
    }

    function fillImageFetchUrl(imageUrl) {
        const fileInput = document.querySelector(fileInputSelector);
        if (fileInput && fileInput.files && fileInput.files.length > 0) {
            return;
        }

        const fetchInput = document.querySelector(fetchUrlSelector);
        if (fetchInput && imageUrl) {
            fetchInput.value = imageUrl;
            fetchInput.dispatchEvent(new Event('input', { bubbles: true }));
            fetchInput.dispatchEvent(new Event('change', { bubbles: true }));

            const nativeBtn = document.querySelector(nativeFetchButtonSelector);
            if (nativeBtn) {
                nativeBtn.disabled = false;
                nativeBtn.click();
            }
        }
    }

    function fillTags(tagsArray) {
        const plainBox = document.querySelector(plainInputSelector);
        const fancyBox = document.querySelector(fancyInputSelector);

        if (!plainBox && !fancyBox) {
            alert('Could not locate the tag input containers on this page.');
            return false;
        }

        const newTagsString = tagsArray.join(', ');

        if (plainBox) {
            const currentVal = plainBox.value.trim();
            plainBox.value = currentVal ? currentVal + ', ' + newTagsString : newTagsString;

            plainBox.dispatchEvent(new Event('input', { bubbles: true }));
            plainBox.dispatchEvent(new Event('change', { bubbles: true }));
        }

        if (fancyBox) {
            const trapContainer = fancyBox.parentElement || fancyBox;
            const trapEnter = (e) => {
                if (e.key === 'Enter' || e.keyCode === 13) {
                    e.stopPropagation();
                }
            };
            trapContainer.addEventListener('keydown', trapEnter, false);

            tagsArray.forEach(tag => {
                fancyBox.value = tag;
                fancyBox.dispatchEvent(new Event('input', { bubbles: true }));

                const enterEvent = new KeyboardEvent('keydown', {
                    bubbles: true,
                    cancelable: true,
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13
                });
                fancyBox.dispatchEvent(enterEvent);
            });

            trapContainer.removeEventListener('keydown', trapEnter, false);
            fancyBox.value = '';
        }

        return true;
    }

    function normalizeTagForSite(tagName, tagCategory, currentSite) {
        const lowerCat = (tagCategory || '').toLowerCase().trim();
        const name = (tagName || '').trim();
        const isTantabus = currentSite && currentSite.domain === 'tantabus.ai';

        const isCreatorType = lowerCat === 'artist' || lowerCat === 'creator' || lowerCat === 'prompter' ||
                              /^(artist|creator|prompter):/i.test(name);

        if (isCreatorType) {
            const cleanName = name.replace(/^(artist|creator|prompter):/i, '');
            return isTantabus ? `creator:${cleanName}` : `artist:${cleanName}`;
        }

        const isEditorType = lowerCat === 'editor' || /^editor:/i.test(name);
        if (isEditorType) {
            const cleanName = name.replace(/^editor:/i, '');
            return `editor:${cleanName}`;
        }

        return name;
    }

    function convertArtistsToPrompters(tagsList) {
        return tagsList.map(tag => {
            if (/^artist:/i.test(tag.trim())) {
                return tag.replace(/^artist:/i, 'prompter:');
            }
            return tag;
        });
    }

    function isMetadataTag(tagName, tagCategory = '') {
        const lowerName = tagName.toLowerCase().trim();
        const lowerCat = tagCategory.toLowerCase().trim();

        if (['generation', 'season'].includes(lowerCat)) {
            return false;
        }

        if (/^g[1-6](\.5)?$/i.test(lowerName) || /^generation\s*\d+$/i.test(lowerName) || /^season\s*\d+$/i.test(lowerName)) {
            return false;
        }

        const metadataCategories = ['artist', 'creator', 'prompter', 'editor', 'character', 'species', 'oc', 'rating'];
        if (metadataCategories.includes(lowerCat)) {
            return true;
        }

        if (/^(artist|creator|prompter|editor|character|species|oc|rating):/i.test(lowerName)) {
            return true;
        }

        if (['safe', 'suggestive', 'questionable', 'explicit', 'artist needed', 'editor needed'].includes(lowerName)) {
            return true;
        }

        if (/^oc:/i.test(lowerName) || /^oc\s+/i.test(lowerName)) {
            return true;
        }

        return false;
    }

    function getCleanCharacterBase(tag) {
        const trimmedTag = tag.trim();
        const prefixMatch = trimmedTag.match(/^(character|oc):/i);
        const prefix = prefixMatch ? prefixMatch[0] : '';
        const tagWithoutPrefix = prefix ? trimmedTag.slice(prefix.length).trim() : trimmedTag;

        const parenMatch = tagWithoutPrefix.match(/^(.*?)\s*\((.*?)\)$/);
        return parenMatch ? parenMatch[1].trim() : tagWithoutPrefix;
    }

    function prepareMetadataForSearch(metadataArray, isRestricted = false, selectedArtist = null) {
        const cleanTags = [];

        metadataArray.forEach(tag => {
            const trimmedTag = tag.trim();
            const lowerTag = trimmedTag.toLowerCase();

            const isRating = ['safe', 'suggestive', 'questionable', 'explicit'].includes(lowerTag) || /^rating:/i.test(trimmedTag);
            const isArtistOrEditor = /^(artist|creator|prompter|editor):/i.test(trimmedTag);

            if (isArtistOrEditor) {
                if (selectedArtist && lowerTag !== selectedArtist.toLowerCase()) {
                    return;
                }
                if (!cleanTags.includes(trimmedTag)) {
                    cleanTags.push(trimmedTag);
                }
                return;
            }

            if (isRating) {
                if (!cleanTags.includes(trimmedTag)) {
                    cleanTags.push(trimmedTag);
                }
                return;
            }

            if (isRestricted) {
                if (!cleanTags.includes(trimmedTag)) {
                    cleanTags.push(trimmedTag);
                }
            } else {
                const baseName = getCleanCharacterBase(trimmedTag);
                if (baseName) {
                    const dualWildcardTag = `*${baseName}*`;
                    if (!cleanTags.includes(dualWildcardTag)) {
                        cleanTags.push(dualWildcardTag);
                    }
                }
            }
        });

        return [...new Set(cleanTags)];
    }

    function showArtistPopup(anchorBtn, container, metadataStore, isRestricted) {
        let existingPopup = document.getElementById('twilight-artist-popup');
        if (existingPopup) {
            existingPopup.remove();
            return;
        }

        const popup = document.createElement('div');
        popup.id = 'twilight-artist-popup';
        popup.style.position = 'absolute';
        popup.style.bottom = '100%';
        popup.style.left = `${anchorBtn.offsetLeft}px`;
        popup.style.marginBottom = '6px';
        popup.style.backgroundColor = '#222222';
        popup.style.border = '1px solid #555555';
        popup.style.borderRadius = '4px';
        popup.style.padding = '6px';
        popup.style.zIndex = '10000';
        popup.style.boxShadow = '0 4px 10px rgba(0,0,0,0.6)';
        popup.style.display = 'flex';
        popup.style.flexDirection = 'column';
        popup.style.gap = '4px';
        popup.style.whiteSpace = 'nowrap';

        const title = document.createElement('div');
        title.innerText = 'Search Options:';
        title.style.color = '#aaaaaa';
        title.style.fontSize = '11px';
        title.style.fontWeight = 'bold';
        title.style.paddingBottom = '2px';
        title.style.borderBottom = '1px solid #444444';
        popup.appendChild(title);

        const makeOptionBtn = (label, selectedArtist = null) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.innerText = label;
            btn.style.backgroundColor = '#333333';
            btn.style.color = '#ffffff';
            btn.style.border = '1px solid #555555';
            btn.style.borderRadius = '3px';
            btn.style.padding = '4px 8px';
            btn.style.fontSize = '12px';
            btn.style.cursor = 'pointer';
            btn.style.textAlign = 'left';

            btn.addEventListener('mouseover', () => { btn.style.backgroundColor = '#444444'; });
            btn.addEventListener('mouseout', () => { btn.style.backgroundColor = '#333333'; });

            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                const searchTags = prepareMetadataForSearch(metadataStore, isRestricted, selectedArtist);
                const searchQuery = searchTags.join(', ');
                const searchUrl = `${window.location.origin}/search?q=${encodeURIComponent(searchQuery)}`;
                window.open(searchUrl, '_blank');
                popup.remove();
            });

            return btn;
        };

        popup.appendChild(makeOptionBtn('Search with All Artists/Prompters'));

        const artistTags = metadataStore.filter(tag => /^(artist|creator|prompter|editor):/i.test(tag.trim()));
        artistTags.forEach(artistTag => {
            popup.appendChild(makeOptionBtn(`Only ${artistTag.trim()}`, artistTag.trim()));
        });

        const closeHandler = (e) => {
            if (!popup.contains(e.target) && e.target !== anchorBtn) {
                popup.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);

        container.appendChild(popup);
    }

    function createUI() {
        injectStyles();

        const container = document.createElement('span');
        container.style.position = 'relative';
        container.style.display = 'inline-flex';
        container.style.alignItems = 'center';
        container.style.marginLeft = '10px';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = CONFIG.TEXT_PLACEHOLDER_INPUT;
        input.id = 'twilight-tags-input';
        input.className = 'input';
        input.style.marginRight = '5px';
        input.style.padding = '4px 8px';
        input.style.width = '180px';
        input.style.background = CONFIG.COLOR_INPUT_BG;
        input.style.color = CONFIG.COLOR_INPUT_TEXT;
        input.style.border = `1px solid ${CONFIG.COLOR_INPUT_BORDER}`;
        input.style.borderRadius = '3px';

        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
        });

        const btn = document.createElement('button');
        btn.innerText = CONFIG.TEXT_BUTTON_FETCH;
        btn.type = 'button';
        btn.className = 'button button--separate-left button--bold';
        btn.style.backgroundColor = CONFIG.COLOR_BUTTON_BG;
        btn.style.border = `1px solid ${CONFIG.COLOR_BUTTON_BORDER}`;
        btn.style.color = CONFIG.COLOR_BUTTON_TEXT;
        btn.style.cursor = 'pointer';

        const checkBtn = document.createElement('button');
        checkBtn.innerText = CONFIG.TEXT_BUTTON_CHECK;
        checkBtn.type = 'button';
        checkBtn.className = 'button button--separate-left button--bold';
        checkBtn.style.backgroundColor = CONFIG.COLOR_CHECK_BG;
        checkBtn.style.border = `1px solid ${CONFIG.COLOR_CHECK_BORDER}`;
        checkBtn.style.color = CONFIG.COLOR_CHECK_TEXT;
        checkBtn.style.cursor = 'pointer';
        checkBtn.style.marginLeft = '5px';
        checkBtn.style.display = 'none';

        const restrictLabel = document.createElement('label');
        restrictLabel.id = 'twilight-restrict-label';
        restrictLabel.style.display = 'none';
        restrictLabel.style.alignItems = 'center';
        restrictLabel.style.marginLeft = '8px';
        restrictLabel.style.color = CONFIG.COLOR_INPUT_TEXT;
        restrictLabel.style.fontSize = '12px';
        restrictLabel.style.cursor = 'pointer';
        restrictLabel.style.userSelect = 'none';

        const restrictCheckbox = document.createElement('input');
        restrictCheckbox.type = 'checkbox';
        restrictCheckbox.id = 'twilight-restrict-tags';
        restrictCheckbox.style.marginRight = '4px';
        restrictCheckbox.style.cursor = 'pointer';

        restrictLabel.appendChild(restrictCheckbox);
        restrictLabel.appendChild(document.createTextNode('Restrict Tags'));

        restrictCheckbox.addEventListener('change', () => {
            checkBtn.dataset.checked = 'false';
            checkBtn.innerText = CONFIG.TEXT_BUTTON_CHECK;
            checkBtn.style.backgroundColor = CONFIG.COLOR_CHECK_BG;
            checkBtn.style.border = `1px solid ${CONFIG.COLOR_CHECK_BORDER}`;

            const existingPopup = document.getElementById('twilight-artist-popup');
            if (existingPopup) existingPopup.remove();
        });

        let targetSearchUrl = '';

        checkBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const isRestricted = restrictCheckbox.checked;

            if (checkBtn.dataset.checked === 'true') {
                const artistTags = fetchedMetadataTagsStore.filter(tag => /^(artist|creator|prompter|editor):/i.test(tag.trim()));

                if (artistTags.length > 1) {
                    showArtistPopup(checkBtn, container, fetchedMetadataTagsStore, isRestricted);
                    return;
                }

                if (targetSearchUrl) {
                    window.open(targetSearchUrl, '_blank');
                    return;
                }
            }

            if (fetchedMetadataTagsStore.length === 0) {
                alert('No artist, prompter, character, species, rating, or editor tags available to perform duplicate search.');
                return;
            }

            checkBtn.innerText = CONFIG.TEXT_BUTTON_CHECKING;

            const searchTags = prepareMetadataForSearch(fetchedMetadataTagsStore, isRestricted);
            const searchQuery = searchTags.join(', ');
            targetSearchUrl = `${window.location.origin}/search?q=${encodeURIComponent(searchQuery)}`;

            GM_xmlhttpRequest({
                method: 'GET',
                url: targetSearchUrl,
                onload: function(response) {
                    if (response.responseText) {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, 'text/html');

                        const tableRows = doc.querySelectorAll('table tbody tr');
                        const imageContainers = doc.querySelectorAll('.image-container, .media-box, .image-box, .js-image-box, [data-image-id], [data-post-id]');

                        const hasTableMatches = Array.from(tableRows).some(row => row.querySelector('.image-container, [data-image-id], a[href^="/"]'));

                        if (hasTableMatches || imageContainers.length > 0) {
                            checkBtn.innerText = CONFIG.TEXT_BUTTON_MATCHES;
                            checkBtn.style.backgroundColor = CONFIG.COLOR_MATCH_BG;
                            checkBtn.style.border = `1px solid ${CONFIG.COLOR_MATCH_BORDER}`;
                            checkBtn.dataset.hasMatches = 'true';
                        } else {
                            checkBtn.innerText = CONFIG.TEXT_BUTTON_NO_MATCHES;
                            checkBtn.style.backgroundColor = CONFIG.COLOR_NOMATCH_BG;
                            checkBtn.style.border = `1px solid ${CONFIG.COLOR_NOMATCH_BORDER}`;
                            checkBtn.dataset.hasMatches = 'false';
                        }

                        checkBtn.dataset.checked = 'true';
                    }
                },
                onerror: function() {
                    checkBtn.innerText = CONFIG.TEXT_BUTTON_CHECK;
                    alert('Error performing tag-based search check.');
                }
            });
        });

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const siteInfo = parseSiteUrl(input.value);

            if (!siteInfo) {
                triggerErrorUI(input, CONFIG.TEXT_ERROR_INVALID_URL);
                return;
            }

            const currentSite = getCurrentSite();
            if (currentSite && siteInfo.domain === currentSite.domain) {
                triggerErrorUI(input, CONFIG.TEXT_ERROR_SAME_HOST);
                return;
            }

            btn.innerText = CONFIG.TEXT_BUTTON_FETCHING;

            GM_xmlhttpRequest({
                method: 'GET',
                url: siteInfo.fullUrl,
                anonymous: false,
                cookiePartition: { topLevelSite: `https://${siteInfo.domain}` },
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                },
                onload: function(response) {
                    btn.innerText = CONFIG.TEXT_BUTTON_FETCH;

                    if (response.responseText && response.responseText.trim().startsWith('<!DOCTYPE html>')) {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, 'text/html');

                        if (doc.title && doc.title.includes('Just a moment')) {
                            alert(`Cloudflare challenge detected! Please open ${siteInfo.domain} in a new tab to complete clearance, then try again.`);
                            return;
                        }

                        let tagNodes = doc.querySelectorAll('.tagsauce .tag-list [data-tag-name], .tagsauce [data-tag-name], .tag-list [data-tag-name], span.tag[data-tag-name]');

                        let tags = [];
                        let metadataTags = [];

                        tagNodes.forEach(node => {
                            const rawTagName = node.getAttribute('data-tag-name') || node.textContent.trim();
                            const tagCategory = node.getAttribute('data-tag-category') || '';

                            if (rawTagName) {
                                const normalizedTag = normalizeTagForSite(rawTagName, tagCategory, currentSite);
                                tags.push(normalizedTag);

                                if (isMetadataTag(normalizedTag, tagCategory)) {
                                    metadataTags.push(normalizedTag);
                                }
                            }
                        });

                        if (tags.length === 0) {
                            const tagNames = doc.querySelectorAll('.tagsauce .tag__name, .tag-list .tag__name');
                            tagNames.forEach(node => {
                                const name = node.textContent.trim();
                                if (name) {
                                    const normalizedTag = normalizeTagForSite(name, '', currentSite);
                                    tags.push(normalizedTag);
                                    if (isMetadataTag(normalizedTag)) {
                                        metadataTags.push(normalizedTag);
                                    }
                                }
                            });
                        }

                        if (currentSite && currentSite.domain === 'derpibooru.org') {
                            if (siteInfo.domain === 'tantabus.ai') {
                                triggerErrorUI(input, CONFIG.TEXT_ERROR_AI_NOT_ALLOWED, true);
                                return;
                            }

                            const hasAiTag = tags.some(tag => {
                                const lowerTag = tag.toLowerCase();
                                return CONFIG.AI_TAG_KEYWORDS.some(aiKeyword => lowerTag.includes(aiKeyword));
                            });

                            if (hasAiTag) {
                                triggerErrorUI(input, CONFIG.TEXT_ERROR_AI_NOT_ALLOWED, true);
                                return;
                            }
                        }

                        tags = tags.filter(tag => !/^[a-z0-9]+\s+import$/i.test(tag.trim()));
                        metadataTags = metadataTags.filter(tag => !/^[a-z0-9]+\s+import$/i.test(tag.trim()));

                        const isFromTantabus = siteInfo.domain === 'tantabus.ai';
                        const isAiImage = isFromTantabus || tags.some(tag => {
                            const lower = tag.toLowerCase();
                            return lower === 'ai generated' || lower.startsWith('generator:');
                        });

                        if (isAiImage) {
                            tags = convertArtistsToPrompters(tags);
                            metadataTags = convertArtistsToPrompters(metadataTags);
                        }

                        const newImportTag = `${siteInfo.siteName.toLowerCase()} import`;
                        tags.push(newImportTag);

                        tags = [...new Set(tags)];
                        metadataTags = [...new Set(metadataTags)];

                        if (tags.length === 0) {
                            alert(`Could not locate any image tags on the ${siteInfo.siteName} page.`);
                            return;
                        }

                        if (currentSite) {
                            const currentSiteImportTag = `${currentSite.name.toLowerCase()} import`;
                            const hasImportTag = tags.some(tag => tag.toLowerCase() === currentSiteImportTag);

                            if (hasImportTag) {
                                triggerErrorUI(input, CONFIG.TEXT_ERROR_ALREADY_EXISTS);
                                return;
                            }
                        }

                        fetchedTagsStore = [...tags];
                        fetchedMetadataTagsStore = [...metadataTags];

                        const directImageUrl = extractDirectImageUrl(doc, siteInfo.fullUrl);
                        fetchedImageUrlStore = directImageUrl || '';

                        const statsData = extractStatsAndDescription(doc, siteInfo.domain);

                        if (fillTags(tags)) {
                            fillSourceUrl(siteInfo.fullUrl);
                            fillDescription(siteInfo, statsData, siteInfo.fullUrl);

                            if (directImageUrl) {
                                fillImageFetchUrl(directImageUrl);
                            }

                            checkBtn.innerText = CONFIG.TEXT_BUTTON_CHECK;
                            checkBtn.style.backgroundColor = CONFIG.COLOR_CHECK_BG;
                            checkBtn.style.border = `1px solid ${CONFIG.COLOR_CHECK_BORDER}`;
                            checkBtn.dataset.hasMatches = 'false';
                            checkBtn.dataset.checked = 'false';
                            checkBtn.style.display = 'inline-block';
                            restrictLabel.style.display = 'inline-flex';
                        }
                    } else {
                        alert('Failed to load page HTML. Status: ' + response.status);
                    }
                },
                onerror: function() {
                    btn.innerText = CONFIG.TEXT_BUTTON_FETCH;
                    alert('Network error whilst fetching page HTML');
                }
            });
        });

        container.appendChild(input);
        container.appendChild(btn);
        container.appendChild(checkBtn);
        container.appendChild(restrictLabel);

        return container;
    }

    function injectUI() {
        const clearBtn = document.getElementById('tagsinput-clear');
        if (clearBtn && !document.getElementById('twilight-tags-input')) {
            clearBtn.parentNode.insertBefore(createUI(), clearBtn.nextSibling);
        }
    }

    injectUI();

    const observer = new MutationObserver(injectUI);
    observer.observe(document.body, { childList: true, subtree: true });
})();