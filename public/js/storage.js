document.addEventListener('DOMContentLoaded', () => {
    const tabDownloader = document.getElementById('tabDownloader');
    const tabClipper = document.getElementById('tabClipper');

    const tabStorage = document.getElementById('tabStorage');

    const sectionDownloader = document.getElementById('downloaderSection');
    const sectionClipper = document.getElementById('clipperSection');
    const sectionStorage = document.getElementById('storageSection');

    const btnRefreshStorage = document.getElementById('btnRefreshStorage'); // Kept for backwards compatibility if needed, but not in HTML anymore
    const storageCategoryFilter = document.getElementById('storageCategoryFilter');
    const storageListContainer = document.getElementById('storageListContainer');

    // --- Custom Storage Category Dropdown Logic ---
    const storageCategoryDropdownWrapper = document.getElementById('storageCategoryDropdownWrapper');
    const storageCategoryBtn = document.getElementById('storageCategoryBtn');
    const storageCategoryMenu = document.getElementById('storageCategoryMenu');
    const storageCategoryLabel = document.getElementById('storageCategoryLabel');
    
    if (storageCategoryBtn && storageCategoryMenu) {
        storageCategoryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            storageCategoryMenu.classList.toggle('hidden');
        });
        
        document.addEventListener('click', (e) => {
            if (storageCategoryDropdownWrapper && !storageCategoryDropdownWrapper.contains(e.target)) {
                storageCategoryMenu.classList.add('hidden');
            }
        });
        
        document.querySelectorAll('.storage-cat-opt').forEach(opt => {
            opt.addEventListener('click', (e) => {
                const val = e.target.getAttribute('data-value');
                const text = e.target.textContent;
                
                storageCategoryLabel.textContent = text;
                storageCategoryMenu.classList.add('hidden');
                
                if (storageCategoryFilter) {
                    storageCategoryFilter.value = val;
                    storageCategoryFilter.dispatchEvent(new Event('change'));
                }
            });
        });
    }

    // --- Media Player State ---
    let storagePlaylist = [];
    let currentPlayIndex = -1;
    let repeatMode = 0; // 0: off, 1: one, 2: all
    let audioContext = null;
    let audioAnalyser = null;
    let audioSource = null;
    let animationId = null;

    // --- Player DOM Elements ---
    const playerModal = document.getElementById('storagePlayerModal');
    const closePlayerBtn = document.getElementById('closeStoragePlayer');
    const playerTitle = document.getElementById('storagePlayerTitle');
    const videoPlayer = document.getElementById('storageVideoPlayer');
    const audioPlayer = document.getElementById('storageAudioPlayer');
    const audioCanvas = document.getElementById('storageAudioCanvas');
    const playBtn = document.getElementById('storagePlayerPlayBtn');
    const prevBtn = document.getElementById('storagePlayerPrevBtn');
    const nextBtn = document.getElementById('storagePlayerNextBtn');
    const stopBtn = document.getElementById('storagePlayerStopBtn');
    const repeatBtn = document.getElementById('storagePlayerRepeatBtn');
    const repeatIcon = document.getElementById('storagePlayerRepeatIcon');
    const repeatBadge = document.getElementById('storagePlayerRepeatBadge');
    const muteBtn = document.getElementById('storagePlayerMuteBtn');
    const volumeSlider = document.getElementById('storagePlayerVolume');
    const progressBar = document.getElementById('storagePlayerProgressBar');
    const progressContainer = document.getElementById('storagePlayerProgressContainer');
    const currentTimeEl = document.getElementById('storagePlayerCurrentTime');
    const durationEl = document.getElementById('storagePlayerDuration');

    function hideAllSections() {
        if (sectionDownloader) sectionDownloader.classList.add('hidden');
        if (sectionClipper) sectionClipper.classList.add('hidden');
        if (sectionStorage) sectionStorage.classList.add('hidden');

        tabDownloader?.classList.remove('active', 'text-primary', 'border-b-2', 'border-primary');
        tabDownloader?.classList.add('text-on-surface-variant');

        tabClipper?.classList.remove('active', 'text-primary', 'border-b-2', 'border-primary');
        tabClipper?.classList.add('text-on-surface-variant');


        if(tabStorage) {
            tabStorage.classList.remove('active', 'text-primary', 'border-b-2', 'border-primary');
            tabStorage.classList.add('text-on-surface-variant');
        }
    }

    if(tabStorage) {
        tabStorage.addEventListener('click', () => {
            hideAllSections();
            
            // Pause all playing videos to prevent audio overlap
            ['videoPlayer', 'trimmerVideoPreview', 'trimmerAudioPreview', 'iframeTop', 'iframeBottom', 'clipperAudioPreview'].forEach(id => {
                const vid = document.getElementById(id);
                if (vid && typeof vid.pause === 'function') {
                    vid.pause();
                }
            });
            
            // Also pause trimmerEngine timeline
            if (typeof trimmerEngine !== 'undefined' && trimmerEngine && trimmerEngine.playback && typeof trimmerEngine.playback.pause === 'function') {
                trimmerEngine.playback.pause();
            }

            // Reset clipper play state
            if (typeof window.setClipperPlayState === 'function') {
                window.setClipperPlayState(false);
            }

            tabStorage.classList.add('active', 'text-primary', 'border-b-2', 'border-primary');
            tabStorage.classList.remove('text-on-surface-variant');
            sectionStorage.classList.remove('hidden');
            // Hide metadata card (thumbnail/title/channel/info) — only visible on Downloader tab
            const metadataCard = document.getElementById('metadataCard');
            if (metadataCard) metadataCard.classList.add('hidden');
            loadFiles();
        });
    }

    if (storageCategoryFilter) {
        storageCategoryFilter.addEventListener('change', loadFiles);
    }

    function formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

    // --- Media Player Logic ---
    function formatTime(seconds) {
        if (isNaN(seconds)) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    function initAudioVisualizer() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioAnalyser = audioContext.createAnalyser();
            audioAnalyser.fftSize = 256;
            audioSource = audioContext.createMediaElementSource(audioPlayer);
            audioSource.connect(audioAnalyser);
            audioAnalyser.connect(audioContext.destination);
        }
    }

    function drawVisualizer() {
        if (!audioCanvas || !audioAnalyser) return;
        const canvasCtx = audioCanvas.getContext('2d');
        const bufferLength = audioAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        audioCanvas.width = audioCanvas.clientWidth;
        audioCanvas.height = audioCanvas.clientHeight;
        
        function renderFrame() {
            animationId = requestAnimationFrame(renderFrame);
            audioAnalyser.getByteFrequencyData(dataArray);
            
            // Clear background for transparency (glassmorphism effect)
            canvasCtx.clearRect(0, 0, audioCanvas.width, audioCanvas.height);
            
            const barWidth = (audioCanvas.width / bufferLength) * 2.5;
            let barHeight;
            let x = 0;
            
            for (let i = 0; i < bufferLength; i++) {
                barHeight = (dataArray[i] / 255) * audioCanvas.height;
                
                // Color gradient (primary FytX color is approx rgb(6, 185, 249))
                const r = 6;
                const g = 185;
                const b = 249;
                
                canvasCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                canvasCtx.fillRect(x, audioCanvas.height - barHeight, barWidth, barHeight);
                x += barWidth + 1;
            }
        }
        renderFrame();
    }

    function playMedia(index) {
        if (index < 0 || index >= storagePlaylist.length) return;
        currentPlayIndex = index;
        const file = storagePlaylist[index];
        
        if (playerModal) playerModal.classList.remove('hidden');
        if (playerTitle) playerTitle.textContent = file.name;
        
        // Pause all background videos to save bandwidth and prevent proxy spam / decoder freeze
        ['trimmerVideoPreview', 'trimmerAudioPreview', 'iframeTop', 'iframeBottom', 'clipperAudioPreview'].forEach(id => {
            const vid = document.getElementById(id);
            if (vid && typeof vid.pause === 'function') {
                vid.pause();
            }
        });
        
        videoPlayer.pause();
        audioPlayer.pause();
        videoPlayer.src = '';
        audioPlayer.src = '';
        
        if (animationId) cancelAnimationFrame(animationId);
        
        const isMp3 = file.name.endsWith('.mp3');
        const audioWrapper = document.getElementById('storageAudioWrapper');
        
        if (isMp3) {
            videoPlayer.classList.add('hidden');
            if (audioWrapper) {
                audioWrapper.classList.remove('hidden');
                audioWrapper.classList.add('flex');
            }
            else audioCanvas.classList.remove('hidden');
            
            audioPlayer.src = file.url;
            audioPlayer.volume = volumeSlider ? volumeSlider.value : 1;
            audioPlayer.play().then(() => {
                initAudioVisualizer();
                if (audioContext.state === 'suspended') audioContext.resume();
                drawVisualizer();
            }).catch(e => console.error("Playback failed:", e));
        } else {
            if (audioWrapper) {
                audioWrapper.classList.add('hidden');
                audioWrapper.classList.remove('flex');
            }
            else audioCanvas.classList.add('hidden');
            
            videoPlayer.classList.remove('hidden');
            videoPlayer.src = file.url;
            videoPlayer.volume = volumeSlider ? volumeSlider.value : 1;
            videoPlayer.play().catch(e => console.error("Playback failed:", e));
        }
        
        updatePlayBtnState();
    }

    function stopMedia() {
        videoPlayer.pause();
        audioPlayer.pause();
        videoPlayer.currentTime = 0;
        audioPlayer.currentTime = 0;
        updatePlayBtnState();
    }

    function togglePlay() {
        if (currentPlayIndex === -1) return;
        const activePlayer = storagePlaylist[currentPlayIndex]?.name.endsWith('.mp3') ? audioPlayer : videoPlayer;
        if (activePlayer.paused) {
            activePlayer.play();
            if (activePlayer === audioPlayer && audioContext?.state === 'suspended') {
                audioContext.resume();
            }
        } else {
            activePlayer.pause();
        }
        updatePlayBtnState();
    }

    function updatePlayBtnState() {
        if (currentPlayIndex === -1) return;
        const activePlayer = storagePlaylist[currentPlayIndex]?.name.endsWith('.mp3') ? audioPlayer : videoPlayer;
        if (activePlayer && !activePlayer.paused) {
            if (playBtn) playBtn.innerHTML = '<span class="material-symbols-outlined text-3xl md:text-4xl">pause</span>';
        } else {
            if (playBtn) playBtn.innerHTML = '<span class="material-symbols-outlined text-3xl md:text-4xl">play_arrow</span>';
        }
    }

    function playNext() {
        if (storagePlaylist.length === 0) return;
        let nextIdx = currentPlayIndex + 1;
        if (nextIdx >= storagePlaylist.length) nextIdx = 0;
        playMedia(nextIdx);
    }

    function playPrev() {
        if (storagePlaylist.length === 0) return;
        let prevIdx = currentPlayIndex - 1;
        if (prevIdx < 0) prevIdx = storagePlaylist.length - 1;
        playMedia(prevIdx);
    }

    function updateProgress(e) {
        const { currentTime, duration } = e.target;
        if (currentTimeEl) currentTimeEl.textContent = formatTime(currentTime);
        if (!isNaN(duration) && durationEl && progressBar) {
            durationEl.textContent = formatTime(duration);
            const percent = (currentTime / duration) * 100;
            progressBar.style.width = `${percent}%`;
        }
    }

    function setProgress(e) {
        if (currentPlayIndex === -1) return;
        const activePlayer = storagePlaylist[currentPlayIndex]?.name.endsWith('.mp3') ? audioPlayer : videoPlayer;
        if (!activePlayer) return;
        const width = progressContainer.clientWidth;
        const clickX = e.offsetX;
        const duration = activePlayer.duration;
        activePlayer.currentTime = (clickX / width) * duration;
    }

    function handleMediaEnded() {
        if (repeatMode === 1) {
            // Repeat One
            const activePlayer = storagePlaylist[currentPlayIndex]?.name.endsWith('.mp3') ? audioPlayer : videoPlayer;
            activePlayer.currentTime = 0;
            activePlayer.play();
        } else if (repeatMode === 2) {
            // Repeat All
            playNext();
        } else {
            // Repeat Off
            if (currentPlayIndex < storagePlaylist.length - 1) {
                playNext();
            } else {
                stopMedia();
            }
        }
    }

    // Event Listeners for Player
    if (playBtn) playBtn.addEventListener('click', togglePlay);
    if (stopBtn) stopBtn.addEventListener('click', stopMedia);
    if (nextBtn) nextBtn.addEventListener('click', playNext);
    if (prevBtn) prevBtn.addEventListener('click', playPrev);
    
    if (closePlayerBtn) closePlayerBtn.addEventListener('click', () => {
        stopMedia();
        playerModal.classList.add('hidden');
        if (animationId) cancelAnimationFrame(animationId);
    });

    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            const vol = e.target.value;
            videoPlayer.volume = vol;
            audioPlayer.volume = vol;
            if (vol == 0) {
                if (muteBtn) muteBtn.innerHTML = '<span class="material-symbols-outlined">volume_off</span>';
            } else {
                if (muteBtn) muteBtn.innerHTML = '<span class="material-symbols-outlined">volume_up</span>';
            }
        });
    }

    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            if (volumeSlider.value > 0) {
                volumeSlider.dataset.prev = volumeSlider.value;
                volumeSlider.value = 0;
            } else {
                volumeSlider.value = volumeSlider.dataset.prev || 1;
            }
            volumeSlider.dispatchEvent(new Event('input'));
        });
    }

    if (repeatBtn) {
        repeatBtn.addEventListener('click', () => {
            repeatMode = (repeatMode + 1) % 3;
            if (repeatMode === 0) {
                repeatIcon.textContent = 'repeat';
                repeatBtn.classList.replace('text-white', 'text-white/50');
                repeatBadge.classList.add('hidden');
            } else if (repeatMode === 1) {
                repeatIcon.textContent = 'repeat_one';
                repeatBtn.classList.replace('text-white/50', 'text-white');
                repeatBadge.classList.add('hidden');
            } else if (repeatMode === 2) {
                repeatIcon.textContent = 'repeat';
                repeatBtn.classList.replace('text-white/50', 'text-white');
                repeatBadge.classList.remove('hidden');
                repeatBadge.textContent = 'ALL';
            }
        });
    }

    if (progressContainer) progressContainer.addEventListener('click', setProgress);
    
    if (videoPlayer) {
        videoPlayer.addEventListener('timeupdate', updateProgress);
        videoPlayer.addEventListener('ended', handleMediaEnded);
        videoPlayer.addEventListener('play', updatePlayBtnState);
        videoPlayer.addEventListener('pause', updatePlayBtnState);
    }
    if (audioPlayer) {
        audioPlayer.addEventListener('timeupdate', updateProgress);
        audioPlayer.addEventListener('ended', handleMediaEnded);
        audioPlayer.addEventListener('play', updatePlayBtnState);
        audioPlayer.addEventListener('pause', updatePlayBtnState);
    }

    // --- End Player Logic ---

    async function loadFiles() {
        if (!storageListContainer) return;
        
        storageListContainer.innerHTML = '<p class="text-white/40 text-sm text-center py-8"><span class="material-symbols-outlined animate-spin text-primary">sync</span> Memuat data...</p>';

        try {
            const res = await fetch('/api/files');
            const data = await res.json();

            if (!data.ok) {
                storageListContainer.innerHTML = `<p class="text-red-400 text-sm py-4">Failed to load file ${data.error}</p>`;
                return;
            }

            let filesToRender = data.files;
            if (storageCategoryFilter && storageCategoryFilter.value !== 'All') {
                filesToRender = filesToRender.filter(f => f.category === storageCategoryFilter.value);
            }

            if (filesToRender.length === 0) {
                storageListContainer.innerHTML = `
                    <div class="text-center py-8 border border-dashed border-white/10 rounded-lg bg-black/20">
                        <span class="material-symbols-outlined text-4xl text-white/20 mb-2">folder_off</span>
                        <p class="text-white/40 text-sm">There are no media files saved in this category yet.</p>
                    </div>`;
                return;
            }

            storageListContainer.innerHTML = '';
            storagePlaylist = filesToRender; // Update playlist
            
            filesToRender.forEach((file, index) => {
                const dateObj = new Date(file.date);
                const dateStr = dateObj.toLocaleDateString('id-ID') + ' ' + dateObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                
                const card = document.createElement('div');
                card.className = 'glass-inner border border-white/10 rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:border-primary/50 cursor-pointer hover:bg-white/5';
                
                card.innerHTML = `
                    <div class="flex items-start gap-3 overflow-hidden pointer-events-none w-full md:w-auto flex-grow">
                        <div class="p-2 bg-primary/20 text-primary rounded-lg shrink-0">
                            <span class="material-symbols-outlined text-[18px] md:text-[24px]">${file.name.endsWith('.mp3') ? 'audio_file' : 'video_file'}</span>
                        </div>
                        <div class="min-w-0 flex-grow">
                            <h4 class="text-white font-medium text-[13px] md:text-sm truncate w-full" title="${file.name}">${file.name}</h4>
                            <div class="flex flex-wrap items-center gap-1.5 md:gap-2 mt-1 text-[10px] md:text-[11px] text-white/50">
                                <span class="bg-white/10 px-1.5 py-0.5 rounded text-white/70">${file.category === 'Full Downloads' ? 'Download' : file.category}</span>
                                <span>•</span>
                                <span>${formatBytes(file.size)}</span>
                                <span>•</span>
                                <span>${dateStr}</span>
                            </div>
                        </div>
                    </div>
                    <div class="w-full h-px bg-white/10 mt-1 mb-1 md:hidden"></div>
                    <div class="shrink-0 w-full md:w-auto flex justify-end items-center gap-3 pr-2">
                        <button class="text-white hover:text-primary transition-colors flex items-center justify-center p-1" onclick="event.stopPropagation(); deleteFile('${file.url}', '${file.name}')" title="Hapus File">
                            <span class="material-symbols-outlined text-[20px] md:text-[24px]">delete</span>
                        </button>
                        <div class="w-px h-5 bg-white/20"></div>
                        <a href="${file.url}" download="${file.name}" class="text-white hover:text-primary transition-colors flex items-center justify-center p-1" onclick="event.stopPropagation()" title="Download to Device">
                            <span class="material-symbols-outlined text-[20px] md:text-[24px]">download</span>
                        </a>
                    </div>
                `;
                
                // Add click listener to the whole card
                card.addEventListener('click', (e) => {
                    playMedia(index);
                });
                
                storageListContainer.appendChild(card);
            });

        } catch (e) {
            storageListContainer.innerHTML = `<p class="text-red-400 text-sm py-4">Error: ${e.message}</p>`;
        }
    }
    
    window.playDirectMedia = function(fileUrl, fileName) {
        storagePlaylist = [{ name: fileName, url: fileUrl }];
        playMedia(0);
    };

    window.deleteFile = function(fileUrl, fileName) {
        const modal = document.getElementById('confirmModal');
        const content = document.getElementById('confirmModalContent');
        const text = document.getElementById('confirmModalText');
        const btnCancel = document.getElementById('cancelConfirmBtn');
        const btnOk = document.getElementById('okConfirmBtn');

        if (!modal || !btnOk) return;

        text.textContent = `Are you sure you want to permanently delete the file "${fileName}" from the server?`;
        
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        
        // Trigger reflow
        void modal.offsetWidth;
        
        modal.classList.remove('opacity-0');
        content.classList.remove('scale-95');
        
        const closeModal = () => {
            modal.classList.add('opacity-0');
            content.classList.add('scale-95');
            setTimeout(() => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }, 300);
        };

        const handleCancel = () => {
            closeModal();
            cleanup();
        };

        const handleOk = async () => {
            closeModal();
            cleanup();
            try {
                const response = await fetch(`/api/files?url=${encodeURIComponent(fileUrl)}`, { method: 'DELETE' });
                
                let result = {};
                try {
                    result = await response.json();
                } catch (e) {
                    // Ignore JSON parse error if body is empty
                }

                if (!response.ok) {
                    throw new Error(result.error || `HTTP Error: ${response.status}`);
                }
                
                if (result.ok) {
                    if (typeof showToast === 'function') showToast('Done', 'The file was successfully deleted from the server.', 'success');
                    loadFiles(); // Refresh list after deletion
                } else {
                    if (typeof showToast === 'function') showToast('Error', 'Failed to delete the file: ' + (result.error || 'Unknown error'), 'error');
                }
            } catch (err) {
                console.error('Delete error:', err);
                if (typeof showToast === 'function') showToast('Error', `Failed to deleted: ${err.message}`, 'error');
            }
        };

        const cleanup = () => {
            btnCancel.removeEventListener('click', handleCancel);
            btnOk.removeEventListener('click', handleOk);
        };

        btnCancel.addEventListener('click', handleCancel);
        btnOk.addEventListener('click', handleOk);
    };
});