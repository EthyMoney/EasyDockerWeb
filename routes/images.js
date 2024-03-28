const express = require('express');
const router = express.Router();
const Docker = require('dockerode');
const docker = new Docker();

const returnImagesRouter = (io) => {
    /* GET users listing. */
    router.get('/', async (req, res, next) => {
        docker.listImages(async (err, listImages) => {
            res.locals.imageName = (str) => {
                if (str) {
                    if (str.length != 0) {
                        return str[0].split(':')[0];
                    }
                }
                return str;
            };
            // image Tag
            res.locals.imageTag = (str) => {
                if (str) {
                    if (str.length != 0) {
                        return str[0].split(':')[1];
                    }
                }
                return str;
            };
            // imageSize
            res.locals.imageSize = (str) => {
                const newSiez = parseInt(str, 10);
                str = (newSiez / 1000 / 1000).toFixed(2).toString().substring(0, 4);
                if (str.indexOf('.') == 3) {
                    return str.split('.')[0];
                }
                return str;
            };
            // checkForUpdates
            res.locals.checkForUpdates = async (name, tag) => {
                try {
                    if (name) {
                        const imageNameWithTag = `${name}:${tag || 'latest'}`;
                        const localImage = docker.getImage(imageNameWithTag);
                        const localImageInspect = await localImage.inspect();
                        if (localImageInspect.RepoDigests && localImageInspect.RepoDigests.length > 0) {
                            const localImageDigest = localImageInspect.RepoDigests[0].split('@')[1];

                            const imageName = encodeURIComponent(name);
                            const imageTag = encodeURIComponent(tag || 'latest');

                            // Fetch token
                            const tokenResponse = await fetch(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${imageName}:pull`, {
                                headers: {
                                    'Content-Type': 'application/json'
                                }
                            });
                            const tokenData = await tokenResponse.json();
                            const token = tokenData.token;

                            console.log(token)

                            // Fetch image manifest
                            const response = await fetch(`https://registry-1.docker.io/v2/${imageName}/manifests/${imageTag}`, {
                                headers: {
                                    'Accept': 'application/vnd.docker.distribution.manifest.v2+json',
                                    'Authorization': `Bearer ${token}`
                                }
                            });
                            if (!response.ok) {
                                console.error(`Error fetching remote image digest for ${name}:${tag || 'latest'}`);
                                console.log(response.status, response.statusText);
                                return null;
                            }

                            const remoteImageDigest = response.headers.get('docker-content-digest');

                            return localImageDigest !== remoteImageDigest;
                        } else {
                            console.log(`No digest available for image: ${name}`);
                            return false;
                        }
                    }
                    return false;
                } catch (error) {
                    console.error(`Error checking for updates for image ${name}:${tag || 'latest'}`);
                    console.error(error);
                    return null;
                }
            };
            const updateChecks = listImages.map(image => {
                const name = res.locals.imageName(image.RepoTags);
                const tag = res.locals.imageTag(image.RepoTags);
                return res.locals.checkForUpdates(name, tag);
            });
            const updateResults = await Promise.all(updateChecks);
            console.log('updateResults', updateResults)
            res.render('images', {
                images: listImages,
                updateResults: updateResults
            });
        });
    });

    router.get('/remove/:id', (req, res, next) => {
        let imageId = req.params.id;
        if (imageId.indexOf(':') > 0) {
            imageId = imageId.split(':')[1];
        }
        let image = docker.getImage(imageId);
        image.remove({force: true}, (err, data) => {
            if (err) {
                res.render('error', {error: err, message: err.json.message});
            } else {
                res.redirect('/images');
            }
        });
    });

    router.get('/search/:name', (req, res, next) => {
        let name = req.params.name;
        docker.searchImages({term: name}, (err, data) => {
            if (err) throw err;
            res.json(data);
        });
    });
    io.on('connection', (socket) => {
        socket.on('pull', (imageName, w, h) => {
            docker.pull(imageName, (err, stream) => {
                if (err) {
                    const tmp = err.toString();
                    socket.emit('show', tmp);
                    setTimeout(() => {
                        socket.emit('end');
                    }, 10000);
                } else {

                    const onFinished = (err, output) => {
                        if (err) {
                            console.log(err);
                        }
                        socket.emit('end');
                    };

                    const onProgress = (event) => {
                        if (event.id) {
                            socket.emit('show',
                                event.status + ':' + event.id + '\n');
                        } else {
                            socket.emit('show', event.status + '\n');
                        }
                        if (event.progress) {
                            socket.emit('show', event.progress + '\n');
                        }
                    };

                    docker.modem.followProgress(stream, onFinished, onProgress);
                }

            });
        });
    });
    return router;
};
module.exports = returnImagesRouter;
