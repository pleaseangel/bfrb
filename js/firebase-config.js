// Firebase Configuration
// Your actual Firebase project config
const firebaseConfig = {
  apiKey: "AIzaSyAwGE1f6n_oRq-pdDy2nuvR_EuDTCNaeG4",
  authDomain: "mybfrb-a89f9.firebaseapp.com",
  projectId: "mybfrb-a89f9",
  storageBucket: "mybfrb-a89f9.firebasestorage.app",
  messagingSenderId: "226276330728",
  appId: "1:226276330728:web:46ddadded7502f15ee4d5d"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Initialize Firestore
const db = firebase.firestore();

// Initialize Auth
const auth = firebase.auth();

// Auth state observer
auth.onAuthStateChanged(function(user) {
  if (user) {
    console.log('User signed in:', user.email);
    // Store user info globally
    window.currentUser = user;
    // Initialize user document if it doesn't exist
    initializeUserDocument(user);
  } else {
    console.log('User signed out');
    window.currentUser = null;
    // Redirect to login if on protected pages
    const protectedPages = ['index.html', 'dashboard.html', 'subscription.html'];
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    
    if (protectedPages.includes(currentPage)) {
      window.location.href = 'login.html';
    }
  }
});

// Initialize user document in Firestore
async function initializeUserDocument(user) {
  try {
    const userRef = db.collection('users').doc(user.uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      // Create new user document with default values
      await userRef.set({
        email: user.email,
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        
        // Subscription info
        subscriptionTier: 'free',
        subscriptionStatus: 'active',
        stripeCustomerId: null,
        subscriptionId: null,
        subscriptionEndDate: null,
        
        // Usage tracking
        dailySessions: {
          date: new Date().toISOString().split('T')[0],
          count: 0
        },
        totalSessions: 0,
        
        // App data
        totalResistPoints: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastSessionDate: null,
        
        // Settings
        settings: {
          soundEnabled: false,
          trainerMode: false,
          customResponses: {
            physical: [],
            breathing: [],
            cognitive: []
          }
        }
      });
      
      console.log('User document created');
    } else {
      // Update last seen
      await userRef.update({
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (error) {
    console.error('Error initializing user document:', error);
  }
}

// Helper function to get user data
async function getUserData(userId = null) {
  try {
    const uid = userId || auth.currentUser?.uid;
    if (!uid) return null;
    
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    return userDoc.exists ? userDoc.data() : null;
  } catch (error) {
    console.error('Error getting user data:', error);
    return null;
  }
}

// Helper function to update user data
async function updateUserData(updates, userId = null) {
  try {
    const uid = userId || auth.currentUser?.uid;
    if (!uid) return false;
    
    const userRef = db.collection('users').doc(uid);
    await userRef.update({
      ...updates,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    return true;
  } catch (error) {
    console.error('Error updating user data:', error);
    return false;
  }
}

// Session tracking functions
async function checkSessionLimit() {
  try {
    const userData = await getUserData();
    if (!userData) return { canStart: false, reason: 'User data not found' };
    
    const today = new Date().toISOString().split('T')[0];
    const dailySessions = userData.dailySessions || { date: today, count: 0 };
    
    // Reset daily count if it's a new day
    let currentCount = dailySessions.count;
    if (dailySessions.date !== today) {
      currentCount = 0;
      await updateUserData({
        dailySessions: { date: today, count: 0 }
      });
    }
    
    // Check limits based on subscription tier
    const limits = {
      free: 3,
      tier1: 10,
      tier2: Infinity
    };
    
    const limit = limits[userData.subscriptionTier] || limits.free;
    const remaining = limit === Infinity ? Infinity : Math.max(0, limit - currentCount);
    
    return {
      canStart: currentCount < limit,
      remaining: remaining,
      tier: userData.subscriptionTier,
      currentCount: currentCount
    };
  } catch (error) {
    console.error('Error checking session limit:', error);
    return { canStart: false, reason: 'Error checking session limit' };
  }
}

async function incrementSessionCount() {
  try {
    const userData = await getUserData();
    if (!userData) return false;
    
    const today = new Date().toISOString().split('T')[0];
    const dailySessions = userData.dailySessions || { date: today, count: 0 };
    
    // Reset daily count if it's a new day
    let newCount = dailySessions.count + 1;
    if (dailySessions.date !== today) {
      newCount = 1;
    }
    
    await updateUserData({
      dailySessions: { date: today, count: newCount },
      totalSessions: (userData.totalSessions || 0) + 1,
      lastSessionDate: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    return true;
  } catch (error) {
    console.error('Error incrementing session count:', error);
    return false;
  }
}

// Save session data
async function saveSessionData(sessionData) {
  try {
    const uid = auth.currentUser?.uid;
    if (!uid) return false;
    
    // Add session to sessions collection
    const sessionRef = db.collection('sessions').doc();
    await sessionRef.set({
      userId: uid,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      date: new Date().toISOString().split('T')[0],
      ...sessionData
    });
    
    // Update user totals
    const userData = await getUserData();
    if (userData) {
      const updates = {
        totalResistPoints: (userData.totalResistPoints || 0) + (sessionData.resistPts || 0)
      };
      
      // Update streak if session was successful
      if (sessionData.trapHits === 0) {
        updates.currentStreak = (userData.currentStreak || 0) + 1;
        updates.longestStreak = Math.max(userData.longestStreak || 0, updates.currentStreak);
      } else if (sessionData.trapHits > 0) {
        updates.currentStreak = 0;
      }
      
      await updateUserData(updates);
    }
    
    return true;
  } catch (error) {
    console.error('Error saving session data:', error);
    return false;
  }
}

// Export functions for use in other files
window.firebaseHelpers = {
  getUserData,
  updateUserData,
  checkSessionLimit,
  incrementSessionCount,
  saveSessionData
};
