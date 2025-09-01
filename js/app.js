// Authentication Logic for Main App
document.addEventListener('DOMContentLoaded', function() {
  const authLoader = document.getElementById('authLoader');
  const appContent = document.getElementById('appContent');
  const userName = document.getElementById('userName');
  const userTier = document.getElementById('userTier');
  const sessionsRemaining = document.getElementById('sessionsRemaining');
  const logoutBtn = document.getElementById('logoutBtn');
  const upgradeBtn = document.getElementById('upgradeBtn');
  const dashboardLink = document.getElementById('dashboardLink');
  const premiumNotice = document.getElementById('premiumNotice');

  // Wait for Firebase to load
  firebase.auth().onAuthStateChanged(async function(user) {
    if (user) {
      // User is signed in
      authLoader.style.display = 'none';
      appContent.style.display = 'block';
      
      // Update user info
      await updateUserInfo(user);
      
      // Load user data and check session limits
      await updateSessionInfo();
      
    } else {
      // No user signed in, redirect to login
      window.location.href = 'login.html';
    }
  });

  // Update user information in the UI
  async function updateUserInfo(user) {
    try {
      const userData = await window.firebaseHelpers.getUserData();
      
      // Update user name
      const displayName = user.displayName || user.email.split('@')[0] || 'User';
      userName.textContent = displayName;
      
      // Update tier badge
      if (userData) {
        const tier = userData.subscriptionTier || 'free';
        userTier.textContent = getTierDisplayName(tier);
        userTier.className = `tier-badge ${tier !== 'free' ? 'premium' : ''}`;
        
        // Show/hide premium features
        if (tier === 'free') {
          premiumNotice.style.display = 'block';
          upgradeBtn.style.display = 'inline-block';
        } else {
          premiumNotice.style.display = 'none';
          dashboardLink.style.display = 'inline';
          if (tier === 'tier2') {
            upgradeBtn.style.display = 'none'; // Hide upgrade for premium users
          }
        }
      }
    } catch (error) {
      console.error('Error updating user info:', error);
      userName.textContent = 'User';
      userTier.textContent = 'Free Plan';
    }
  }

  // Update session information
  async function updateSessionInfo() {
    try {
      const sessionCheck = await window.firebaseHelpers.checkSessionLimit();
      
      if (sessionCheck.canStart) {
        let remainingText;
        if (sessionCheck.remaining === Infinity) {
          remainingText = 'Unlimited sessions';
        } else {
          remainingText = `${sessionCheck.remaining} session${sessionCheck.remaining !== 1 ? 's' : ''} remaining today`;
        }
        
        sessionsRemaining.textContent = remainingText;
        sessionsRemaining.style.color = '';
        
        // Hide session limit warning if it's showing
        const warning = document.getElementById('sessionLimitWarning');
        if (warning) {
          warning.style.display = 'none';
        }
      } else {
        sessionsRemaining.textContent = 'Daily limit reached';
        sessionsRemaining.style.color = 'var(--warn)';
        
        // Don't auto-show warning here, let the start button trigger it
      }
    } catch (error) {
      console.error('Error checking session limits:', error);
      sessionsRemaining.textContent = 'Unable to check sessions';
      sessionsRemaining.style.color = 'var(--warn)';
    }
  }

  // Show session limit warning
  function showSessionLimitWarning() {
    const warning = document.getElementById('sessionLimitWarning');
    if (warning) {
      warning.style.display = 'flex';
    }
  }

  // Hide session limit warning
  function hideSessionLimitWarning() {
    const warning = document.getElementById('sessionLimitWarning');
    if (warning) {
      warning.style.display = 'none';
    }
  }

  // Get display name for subscription tier
  function getTierDisplayName(tier) {
    const tierNames = {
      'free': 'Free Plan',
      'tier1': 'Pro Plan ($7/month)',
      'tier2': 'Premium Plan ($15/month)'
    };
    return tierNames[tier] || 'Free Plan';
  }

  // Logout functionality
  logoutBtn.addEventListener('click', async function() {
    try {
      // Show loading state
      logoutBtn.textContent = 'Signing out...';
      logoutBtn.disabled = true;
      
      await firebase.auth().signOut();
      // Redirect handled by onAuthStateChanged
    } catch (error) {
      console.error('Error signing out:', error);
      showToast('Error signing out. Please try again.');
      
      // Reset button
      logoutBtn.textContent = 'Logout';
      logoutBtn.disabled = false;
    }
  });

  // Upgrade button
  upgradeBtn.addEventListener('click', function() {
    window.location.href = 'subscription.html';
  });

  // Close session warning when clicking outside
  document.addEventListener('click', function(e) {
    const warning = document.getElementById('sessionLimitWarning');
    const warningCard = document.querySelector('.warning-card');
    
    if (warning && warning.style.display === 'flex') {
      if (!warningCard.contains(e.target)) {
        hideSessionLimitWarning();
      }
    }
  });

  // Utility function to show toast messages
  window.showToast = function(message, duration = 3000) {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, duration);
    }
  };

  // Export functions for use by app.js
  window.updateSessionInfo = updateSessionInfo;
  window.showSessionLimitWarning = showSessionLimitWarning;
  window.hideSessionLimitWarning = hideSessionLimitWarning;

  // Check for email verification status
  firebase.auth().onAuthStateChanged(function(user) {
    if (user && !user.emailVerified) {
      // Show a subtle reminder about email verification
      setTimeout(() => {
        showToast('💡 Tip: Verify your email for better account security', 5000);
      }, 3000);
    }
  });

  // Handle network status
  window.addEventListener('online', function() {
    showToast('✅ Connection restored');
  });

  window.addEventListener('offline', function() {
    showToast('⚠️ No internet connection', 5000);
  });

  // Performance monitoring
  window.addEventListener('load', function() {
    // Simple performance check
    if (performance.now() > 3000) {
      console.warn('App took longer than 3 seconds to load');
    }
  });
});
