// Main BFRB Urge Simulator Application Logic
document.addEventListener('DOMContentLoaded', function() {
  // Wait for authentication to complete
  firebase.auth().onAuthStateChanged(function(user) {
    if (user) {
      initializeApp();
    }
  });

  function initializeApp() {
    // --- Utility Functions ---
    const $ = (s) => document.querySelector(s);
    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const vibrate = (ms) => { 
      try { 
        if (navigator.vibrate) navigator.vibrate(ms); 
      } catch(_){} 
    };
    
    // --- Sound System ---
    let audioContext = null;
    
    function initAudioContext() {
      if (!audioContext) {
        try {
          audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch(_) {
          console.log('Audio context not available');
        }
      }
    }
    
    const createClick = () => {
      if (!soundEnabled || !audioContext) return;
      try {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.frequency.value = 400;
        gain.gain.value = 0.05;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
        osc.stop(audioContext.currentTime + 0.1);
      } catch(_){}
    };

    const createBeep = (freq, duration) => {
      if (!soundEnabled || !audioContext) return;
      try {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.frequency.value = freq;
        gain.gain.value = 0.1;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration/1000);
        osc.stop(audioContext.currentTime + duration/1000);
      } catch(_){}
    };

    // --- App State ---
    const DURATION_SEC = 180; // 3 min session
    const HAIR_COUNT = 96;
    const TRAP_RATIO = 0.22;

    let running = false;
    let tLeft = DURATION_SEC;
    let timer = null;
    let resistPts = 0;
    let trapHits = 0;
    let pullAttempts = 0;
    let lastActionTs = Date.now();
    let trainerMode = false;
    let soundEnabled = false;
    let reshuffleTimer = null;
    let countdownTimer = null;

    // --- Competing Responses ---
    let competingResponses = {
      physical: [
        "Squeeze your fists tight and hold",
        "Clasp hands behind your back firmly",
        "Press palms together at chest level",
        "Grip chair armrests or table edge",
        "Cross arms and squeeze shoulders"
      ],
      breathing: [
        "Take 5 slow, deep belly breaths",
        "Breathe in for 4, hold 4, out for 6", 
        "Focus on exhaling twice as long as inhaling",
        "Take 3 deep breaths through your nose",
        "Breathe deeply and relax jaw & shoulders"
      ],
      cognitive: [
        "Count backwards from 20 slowly",
        "Name 5 things you can see around you",
        "Repeat 'I choose to pause' 3 times",
        "Think of your favorite peaceful place",
        "List 3 things you're grateful for today"
      ]
    };

    // --- User Settings Management ---
    async function loadUserSettings() {
      try {
        const userData = await window.firebaseHelpers.getUserData();
        if (userData && userData.settings) {
          soundEnabled = userData.settings.soundEnabled || false;
          trainerMode = userData.settings.trainerMode || false;
          
          // Load custom responses
          if (userData.settings.customResponses) {
            Object.keys(userData.settings.customResponses).forEach(category => {
              const customResponses = userData.settings.customResponses[category];
              if (customResponses && customResponses.length > 0) {
                // Add custom responses to the end of existing ones
                competingResponses[category] = [
                  ...competingResponses[category],
                  ...customResponses
                ];
              }
            });
          }
          
          // Update UI
          $('#soundBtn').textContent = soundEnabled ? 'Sound: ON' : 'Sound: OFF';
          $('#trainerBtn').textContent = trainerMode ? 'Trainer mode: ON' : 'Trainer mode';
          
          // Update streak from user data
          if (userData.currentStreak !== undefined) {
            $('#streak').textContent = userData.currentStreak;
          }
        }
      } catch (error) {
        console.error('Error loading user settings:', error);
      }
    }

    async function saveUserSettings() {
      try {
        // Extract only custom responses (beyond default counts)
        const customResponsesOnly = { physical: [], breathing: [], cognitive: [] };
        const defaultCounts = { physical: 5, breathing: 5, cognitive: 5 };
        
        Object.keys(competingResponses).forEach(category => {
          if (competingResponses[category].length > defaultCounts[category]) {
            customResponsesOnly[category] = competingResponses[category].slice(defaultCounts[category]);
          }
        });

        await window.firebaseHelpers.updateUserData({
          'settings.soundEnabled': soundEnabled,
          'settings.trainerMode': trainerMode,
          'settings.customResponses': customResponsesOnly
        });
      } catch (error) {
        console.error('Error saving user settings:', error);
      }
    }

    // --- Custom Response Management ---
    function addCustomResponse() {
      const category = $('#categorySelect').value;
      const response = $('#customInput').value.trim();
      if (response) {
        competingResponses[category].push(response);
        $('#customInput').value = '';
        saveUserSettings();
        updateResponseList();
        showToast('Response added');
      }
    }

    function removeCustomResponse(category, index) {
      const defaultCounts = { physical: 5, breathing: 5, cognitive: 5 };
      if (index >= defaultCounts[category]) {
        competingResponses[category].splice(index, 1);
        saveUserSettings();
        updateResponseList();
        showToast('Response removed');
      }
    }

    function updateResponseList() {
      const category = $('#categorySelect').value;
      const list = $('#responseList');
      const defaultCounts = { physical: 5, breathing: 5, cognitive: 5 };
      
      list.innerHTML = competingResponses[category].map((response, index) => {
        const isDefault = index < defaultCounts[category];
        return `
          <div class="response-item">
            <span class="muted" style="flex:1;">${response}</span>
            ${!isDefault ? `<button class="remove-btn" onclick="removeCustomResponse('${category}', ${index})">Remove</button>` : ''}
          </div>
        `;
      }).join('');
    }

    // Make removeCustomResponse available globally
    window.removeCustomResponse = removeCustomResponse;

    // --- HUD Updates ---
    function updateHUD() {
      $('#clock').textContent = fmtClock(tLeft);
      $('#resist').textContent = resistPts;
      $('#hits').textContent = trapHits;
      $('#pulls').textContent = pullAttempts;
    }

    function fmtClock(s) { 
      const m = Math.floor(s / 60);
      const ss = String(s % 60).padStart(2, '0'); 
      return `${String(m).padStart(2, '0')}:${ss}`;
    }

    // --- Hair Patch Management ---
    function buildPatch(reshuffleOnly = false) {
      const patch = $('#patch');
      if (!reshuffleOnly) {
        patch.querySelectorAll('.hair').forEach(n => n.remove());
      }
      
      const w = patch.clientWidth;
      const h = patch.clientHeight;
      const count = HAIR_COUNT;
      const trapCount = Math.max(1, Math.floor(count * TRAP_RATIO));
      const trapIdx = new Set();
      
      // Generate random trap indices
      while (trapIdx.size < trapCount) {
        trapIdx.add(rand(0, count - 1));
      }

      const hairs = patch.querySelectorAll('.hair');
      
      for (let i = 0; i < count; i++) {
        let hair;
        
        if (reshuffleOnly && hairs[i]) {
          // Existing hair - just update trap status
          hair = hairs[i];
          hair.classList.remove('trap', 'safe');
          hair.style.boxShadow = '';
        } else {
          // New hair - create element and position
          hair = document.createElement('div');
          const x = rand(18, w - 18);
          const y = rand(Math.floor(h * 0.40), Math.floor(h * 0.86));
          const len = rand(48, 96);
          
          hair.style.left = x + 'px';
          hair.style.top = (y - len) + 'px';
          hair.style.height = len + 'px';
          hair.style.transform = `rotate(${rand(-10, 10)}deg)`;
        }
        
        // Set trap or safe class
        hair.className = 'hair ' + (trapIdx.has(i) ? 'trap' : 'safe');
        
        // Show trap indicators in trainer mode
        if (trainerMode && hair.classList.contains('trap')) { 
          hair.style.boxShadow = '0 0 0 2px rgba(239,68,68,0.25)'; 
        }

        if (!reshuffleOnly) {
          // Add event listeners for new hairs
          const hit = (e) => {
            if (!running) return;
            e.preventDefault();
            
            hair.classList.add('hit');
            pullAttempts++;
            lastActionTs = Date.now();
            updateHUD();
            
            // Play click sound for awareness
            createClick();
            
            if (hair.classList.contains('trap')) {
              triggerTrap();
            }
            
            setTimeout(() => hair.classList.remove('hit'), 120);
          };
          
          hair.addEventListener('mousedown', hit);
          hair.addEventListener('touchstart', hit, {passive: false});
          patch.appendChild(hair);
        }
      }
    }

    // --- Trap System ---
    function triggerTrap() {
      trapHits++;
      updateHUD();
      vibrate([0, 50, 40, 50]);
      createBeep(800, 200);
      
      // Select random competing response
      const categories = Object.keys(competingResponses);
      const category = categories[rand(0, categories.length - 1)];
      const responses = competingResponses[category];
      const response = responses[rand(0, responses.length - 1)];
      
      // Update overlay content
      $('#categoryTag').textContent = category.charAt(0).toUpperCase() + category.slice(1);
      $('#pauseMessage').textContent = response;
      
      const overlay = $('#overlay'); 
      overlay.classList.add('show');
      
      // Start 8-second countdown
      let count = 8;
      $('#countdown').textContent = count;
      countdownTimer = setInterval(() => {
        count--;
        $('#countdown').textContent = count;
        if (count <= 0) {
          clearInterval(countdownTimer);
          overlay.classList.remove('show');
        }
      }, 1000);
      
      showToast('Pause + follow the competing response');
    }

    // --- Session Management ---
    async function start() { 
      if (running) return;
      
      // Initialize audio context on user interaction
      initAudioContext();
      
      // Check session limits
      const sessionCheck = await window.firebaseHelpers.checkSessionLimit();
      if (!sessionCheck.canStart) {
        showToast('Daily session limit reached. Upgrade for more sessions!');
        if (window.showSessionLimitWarning) {
          window.showSessionLimitWarning();
        }
        return;
      }
      
      // Increment session count
      await window.firebaseHelpers.incrementSessionCount();
      
      // Start session
      running = true; 
      tick(); 
      timer = setInterval(tick, 1000); 
      reshuffleTimer = setInterval(() => { 
        if (running) buildPatch(true); 
      }, 20000); // Reshuffle every 20 seconds
      
      showToast('Session started'); 
      
      // Update session info in UI
      if (window.updateSessionInfo) {
        setTimeout(window.updateSessionInfo, 1000);
      }
    }

    function reset() { 
      running = false; 
      clearInterval(timer); 
      clearInterval(reshuffleTimer);
      clearInterval(countdownTimer);
      
      // Reset values
      tLeft = DURATION_SEC;
      resistPts = 0;
      trapHits = 0;
      pullAttempts = 0;
      
      updateHUD();
      buildPatch();
      showToast('Session reset'); 
    }

    function tick() {
      if (!running) return;
      
      tLeft--;
      if (tLeft <= 0) { 
        complete(); 
        return; 
      }
      
      // Award resist points for idle time
      const idle = (Date.now() - lastActionTs) / 1000;
      if (idle >= 10) { 
        resistPts++; 
        lastActionTs = Date.now(); 
        updateHUD(); 
      }
      
      updateHUD();
    }

    async function complete() {
      running = false; 
      clearInterval(timer);
      clearInterval(reshuffleTimer);
      clearInterval(countdownTimer);
      
      const success = trapHits === 0;
      
      // Save session data to Firebase
      const sessionData = {
        resistPts: resistPts,
        trapHits: trapHits,
        pullAttempts: pullAttempts,
        duration: DURATION_SEC - tLeft,
        completed: tLeft <= 0,
        success: success
      };
      
      await window.firebaseHelpers.saveSessionData(sessionData);
      
      // Show completion message
      if (success) { 
        showToast('🎉 Perfect session! No trap hits. Streak updated!'); 
        vibrate(60); 
      } else { 
        showToast('Session complete. Keep practicing!'); 
      }
      
      // Refresh user data to update streak display
      setTimeout(async () => {
        try {
          const userData = await window.firebaseHelpers.getUserData();
          if (userData && userData.currentStreak !== undefined) {
            $('#streak').textContent = userData.currentStreak;
          }
        } catch (error) {
          console.error('Error updating streak display:', error);
        }
      }, 1500);
    }

    // --- Breathing Helper ---
    function breathing60() {
      let secs = 60; 
      const breatheBtn = $('#breatheBtn');
      const originalText = breatheBtn.textContent;
      
      const id = setInterval(() => {
        secs--;
        breatheBtn.textContent = `Breathing ${secs}s`;
        if (secs <= 0) { 
          clearInterval(id); 
          breatheBtn.textContent = originalText; 
          showToast('Breathing exercise complete!'); 
        }
      }, 1000);
    }

    // --- Event Listeners ---
    $('#startBtn').addEventListener('click', start);
    $('#resetBtn').addEventListener('click', reset);
    $('#breatheBtn').addEventListener('click', breathing60);
    
    $('#trainerBtn').addEventListener('click', () => { 
      trainerMode = !trainerMode; 
      $('#trainerBtn').textContent = trainerMode ? 'Trainer mode: ON' : 'Trainer mode'; 
      buildPatch(); 
      showToast(trainerMode ? 'Trainer mode enabled' : 'Trainer mode disabled');
      saveUserSettings();
    });
    
    $('#soundBtn').addEventListener('click', () => { 
      soundEnabled = !soundEnabled; 
      $('#soundBtn').textContent = soundEnabled ? 'Sound: ON' : 'Sound: OFF'; 
      showToast(soundEnabled ? 'Sound enabled' : 'Sound disabled');
      saveUserSettings();
      
      // Initialize audio context if enabling sound
      if (soundEnabled) {
        initAudioContext();
      }
    });
    
    $('#customBtn').addEventListener('click', () => { 
      const panel = $('#customPanel'); 
      const isHidden = panel.style.display === 'none';
      panel.style.display = isHidden ? 'block' : 'none'; 
      $('#customBtn').textContent = isHidden ? 'Hide Customize' : 'Customize';
      if (isHidden) updateResponseList();
    });
    
    $('#categorySelect').addEventListener('change', updateResponseList);
    $('#customInput').addEventListener('keypress', (e) => { 
      if (e.key === 'Enter') addCustomResponse(); 
    });
    $('#addCustomBtn').addEventListener('click', addCustomResponse);

    // --- Initialization ---
    window.addEventListener('load', async () => { 
      await loadUserSettings();
      buildPatch(); 
      updateHUD(); 
      updateResponseList();
    });
    
    window.addEventListener('resize', () => { 
      buildPatch(); 
    });

    // Initialize immediately if DOM is already loaded
    loadUserSettings().then(() => {
      buildPatch();
      updateHUD();
      updateResponseList();
    });

    console.log('BFRB Urge Simulator initialized successfully');
  }
});
