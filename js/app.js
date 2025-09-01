// Main BFRB Urge Simulator Application Logic
document.addEventListener('DOMContentLoaded', function() {
  // Wait for authentication to complete
  firebase.auth().onAuthStateChanged(function(user) {
    if (user) {
      initializeApp();
    }
  });

  function initializeApp() {
    // --- Utility ---
    const $ = (s) => document.querySelector(s);
    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const vibrate = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch(_){} };
    
    // Create sounds
    const createClick = () => {
      if (!soundEnabled) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 400; gain.gain.value = 0.05;
        osc.start(); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.stop(ctx.currentTime + 0.1);
      } catch(_){}
    };

    const createBeep = (freq, duration) => {
      if (!soundEnabled) return;
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq; gain.gain.value = 0.1;
        osc.start(); gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration/1000);
        osc.stop(ctx.currentTime + duration/1000);
      } catch(_){}
    };

    // --- State ---
    const DURATION_SEC = 180; // 3 min session
    const HAIR_COUNT = 96;
    const TRAP_RATIO = 0.22;

    let running = false, tLeft = DURATION_SEC, timer = null, resistPts = 0, trapHits = 0, pullAttempts = 0;
    let lastActionTs = Date.now();
    let trainerMode = false, soundEnabled = false;
    let reshuffleTimer = null;
    let countdownTimer = null;

    // Competing responses by category
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

    // Load user settings and custom responses
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
                competingResponses[category] = [...competingResponses[category], ...customResponses];
              }
            });
          }
          
          // Update UI
          $('#soundBtn').textContent = soundEnabled ? 'Sound: ON' : 'Sound: OFF';
          $('#trainerBtn').textContent = trainerMode ? 'Trainer mode: ON' : 'Trainer mode';
          
          // Update streak from user data
          if (userData.currentStreak) {
            $('#streak').textContent = userData.currentStreak;
          }
        }
      } catch (error) {
        console.error('Error loading user settings:', error);
      }
    }

    // Save user settings
    async function saveUserSettings() {
      try {
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

    // Custom response management
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

    // HUD updates
    function updateHUD() {
      $('#clock').textContent = fmtClock(tLeft);
      $('#resist').textContent = resistPts;
      $('#hits').textContent = trapHits;
      $('#pulls').textContent = pullAttempts;
    }

    function fmtClock(s) { 
      const m = Math.floor(s / 60), ss = String(s % 60).padStart(2, '0'); 
      return `${String(m).padStart(2, '0')}:${ss}` 
    }

    // Build hair patch
    function buildPatch(reshuffleOnly = false) {
      const patch = $('#patch');
      if (!reshuffleOnly) {
        patch.querySelectorAll('.hair').forEach(n => n.remove());
      }
      const w = patch.clientWidth, h = patch.clientHeight;
      const count = HAIR_COUNT;
      const trapCount = Math.max(1, Math.floor(count * TRAP_RATIO));
      const trapIdx = new Set();
      while (trapIdx.size < trapCount) trapIdx.add(rand(0, count - 1));

      const hairs = patch.querySelectorAll('.hair');
      
      for (let i = 0; i < count; i++) {
        let hair;
        if (reshuffleOnly && hairs[i]) {
          hair = hairs[i];
          hair.classList.remove('trap', 'safe');
          hair.style.boxShadow = '';
        } else {
          hair = document.createElement('div');
          const x = rand(18, w - 18);
          const y = rand(Math.floor(h * 0.40), Math.floor(h * 0.86));
          const len = rand(48, 96);
          hair.style.left = (x) + 'px';
          hair.style.top = (y - len) + 'px';
          hair.style.height = len + 'px';
          hair.style.transform = `rotate(${rand(-10, 10)}deg)`;
        }
        
        hair.className = 'hair ' + (trapIdx.has(i) ? 'trap' : 'safe');
        if (trainerMode && hair.classList.contains('trap')) { 
          hair.style.boxShadow = '0 0 0 2px rgba(239,68,68,0.25)'; 
        }

        if (!reshuffleOnly) {
          const hit = (e) => {
            if (!running) return;
            e.preventDefault();
            hair.classList.add('hit');
            pullAttempts++; lastActionTs = Date.now(); updateHUD();
            
            createClick();
            
            if (hair.classList.contains('trap')) triggerTrap();
            setTimeout(() => hair.classList.remove('hit'), 120);
          };
          hair.addEventListener('mousedown', hit);
          hair.addEventListener('touchstart', hit, {passive: false});
          patch.appendChild(hair);
        }
      }
    }

    // Trigger trap
    function triggerTrap() {
      trapHits++; updateHUD(); vibrate([0,50,40,50]); createBeep(800, 200);
      
      const categories = Object.keys(competingResponses);
      const category = categories[rand(0, categories.length - 1)];
      const responses = competingResponses[category];
      const response = responses[rand(0, responses.length - 1)];
      
      $('#categoryTag').textContent = category.charAt(0).toUpperCase() + category.slice(1);
      $('#pauseMessage').textContent = response;
      
      const ov = $('#overlay'); 
      ov.classList.add('show');
      
      let count = 8;
      $('#countdown').textContent = count;
      countdownTimer = setInterval(() => {
        count--;
        $('#countdown').textContent = count;
        if (count <= 0) {
          clearInterval(countdownTimer);
          ov.classList.remove('show');
        }
      }, 1000);
      
      showToast('Pause + follow the competing response');
    }

    // Session management
    async function start() { 
      if (running) return;
      
      // Check session limits
      const sessionCheck = await window.firebaseHelpers.checkSessionLimit();
      if (!sessionCheck.canStart) {
        showToast('Daily session limit reached. Upgrade for more sessions!');
        document.getElementById('sessionLimitWarning').style.display = 'flex';
        return;
      }
      
      // Increment session count
      await window.firebaseHelpers.incrementSessionCount();
      
      running = true; 
      tick(); 
      timer = setInterval(tick, 1000); 
      reshuffleTimer = setInterval(() => { if (running) buildPatch(true); }, 20000);
      showToast('Session started'); 
      
      // Update session info in UI
      if (window.updateSessionInfo) {
        window.updateSessionInfo();
      }
    }

    function reset() { 
      running = false; 
      clearInterval(timer); 
      clearInterval(reshuffleTimer);
      clearInterval(countdownTimer);
      tLeft = DURATION_SEC; resistPts = 0; trapHits = 0; pullAttempts = 0; 
      updateHUD(); buildPatch(); 
      showToast('Session reset'); 
    }

    function tick() {
      if (!running) return;
      tLeft--; if (tLeft <= 0) { complete(); return; }
      const idle = (Date.now() - lastActionTs) / 1000;
      if (idle >= 10) { resistPts++; lastActionTs = Date.now(); updateHUD(); }
      updateHUD();
    }

    async function complete() {
      running = false; 
      clearInterval(timer);
      clearInterval(reshuffleTimer);
      clearInterval(countdownTimer);
      
      const success = trapHits === 0;
      
      // Save session data to Firebase
      await window.firebaseHelpers.saveSessionData({
        resistPts: resistPts,
        trapHits: trapHits,
        pullAttempts: pullAttempts,
        duration: DURATION_SEC - tLeft,
        completed: tLeft <= 0
      });
      
      if (success) { 
        showToast('Completed without trap hits. Streak updated!'); 
        vibrate(60); 
      } else { 
        showToast('Session complete'); 
      }
      
      // Refresh user data to update streak display
      setTimeout(async () => {
        const userData = await window.firebaseHelpers.getUserData();
        if (userData) {
          $('#streak').textContent = userData.currentStreak || 0;
        }
      }, 1000);
    }

    // Breathing helper
    function breathing60() {
      let secs = 60; 
      const id = setInterval(() => {
        secs--; $('#breatheBtn').textContent = `Breathing ${secs}s`;
        if (secs <= 0) { 
          clearInterval(id); 
          $('#breatheBtn').textContent = 'Breathing 60s'; 
          showToast('Done'); 
        }
      }, 1000);
    }

    // Event Listeners
    $('#startBtn').addEventListener('click', start);
    $('#resetBtn').addEventListener('click', reset);
    $('#breatheBtn').addEventListener('click', breathing60);
    
    $('#trainerBtn').addEventListener('click', () => { 
      trainerMode = !trainerMode; 
      $('#trainerBtn').textContent = trainerMode ? 'Trainer mode: ON' : 'Trainer mode'; 
      buildPatch(); 
      showToast(trainerMode ? 'Trainer mode on' : 'Trainer mode off');
      saveUserSettings();
    });
    
    $('#soundBtn').addEventListener('click', () => { 
      soundEnabled = !soundEnabled; 
      $('#soundBtn').textContent = soundEnabled ? 'Sound: ON' : 'Sound: OFF'; 
      showToast(soundEnabled ? 'Sound enabled' : 'Sound disabled');
      saveUserSettings();
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

    // Initialize
    window.addEventListener('load', () => { 
      loadUserSettings();
      buildPatch(); 
      updateHUD(); 
      updateResponseList();
    });
    
    window.addEventListener('resize', () => { buildPatch(); });

    // Load settings when app starts
    loadUserSettings();
    buildPatch();
    updateHUD();
  }
});
