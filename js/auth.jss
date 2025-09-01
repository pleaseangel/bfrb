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
      updateUserInfo(user);
      
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
      userName.textContent = user.displayName || user.email.split('@')[0] || 'User';
      
      // Update tier badge
      if (userData) {
        const tier = userData.subscriptionTier || 'free';
        userTier.textContent = getTierDisplayName(tier);
        userTier.className = `tier-badge ${tier !== 'free' ? 'premium' : ''}`;
        
        // Show/hide premium features
        if (tier === 'free') {
          premiumNotice.style.display = 'block';
        } else {
          premiumNotice.style.display = 'none';
          dashboardLink.style.display = 'inline';
        }
      }
    } catch (error) {
      console.error('Error updating user info:', error);
    }
  }

  // Update session information
  async function updateSessionInfo() {
    try {
      const sessionCheck = await window.firebaseHelpers.checkSessionLimit();
      
      if (sessionCheck.canStart) {
        const remaining = sessionCheck.remaining === Infinity ? 
          'Unlimited' : 
          `${sessionCheck.remaining} session${sessionCheck.remaining !== 1 ? 's' : ''}`;
        sessionsRemaining.textContent = `${remaining} remaining today`;
        sessionsRemaining.style.color = '';
      } else {
        sessionsRemaining.textContent = 'Daily limit reached';
        sessionsRemaining.style.color = 'var(--warn)';
        // Show session limit warning
        showSessionLimitWarning();
      }
    } catch (error) {
      console.error('Error checking session limits:', error);
      sessionsRemaining.textContent = 'Unable to check sessions';
    }
  }

  // Show session limit warning
  function showSessionLimitWarning() {
    const warning = document.getElementById('sessionLimitWarning');
    warning.style.display = 'flex';
  }

  // Get display name for subscription tier
  function getTierDisplayName(tier) {
    const tierNames = {
      'free': 'Free Plan',
      'tier1': 'Pro Plan',
      'tier2': 'Premium Plan'
    };
    return tierNames[tier] || 'Free Plan';
  }

  // Logout functionality
  logoutBtn.addEventListener('click', async function() {
    try {
      await firebase.auth().signOut();
      // Redirect handled by onAuthStateChanged
    } catch (error) {
      console.error('Error signing out:', error);
      showToast('Error signing out. Please try again.');
    }
  });

  // Upgrade button
  upgradeBtn.addEventListener('click', function() {
    window.location.href = 'subscription.html';
  });

  // Utility function to show toast messages
  window.showToast = function(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  };

  // Export session info update function for use by app.js
  window.updateSessionInfo = updateSessionInfo;
});
