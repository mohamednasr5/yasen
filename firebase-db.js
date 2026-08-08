/**
 * Firebase Realtime Database Module
 * مدير الطباعة - قاعدة البيانات اللحظية
 */

// Firebase Configuration - استبدل هذه القيم بمشروعك
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Database State
const dbState = {
  initialized: false,
  currentUser: null,
  database: null,
  listeners: {}
};

/**
 * Initialize Firebase and Realtime Database
 */
function initFirebaseDatabase() {
  console.log('[Firebase] Initializing...');
  
  // Check if Firebase is loaded
  if (typeof firebase === 'undefined') {
    console.warn('[Firebase] SDK not loaded, loading...');
    loadFirebaseSDK();
    return;
  }
  
  try {
    firebase.initializeApp(firebaseConfig);
    dbState.database = firebase.database();
    dbState.initialized = true;
    
    console.log('[Firebase] Initialized successfully');
    
    // Listen for auth state changes
    firebase.auth().onAuthStateChanged((user) => {
      dbState.currentUser = user;
      console.log('[Firebase] Auth state changed:', user ? user.uid : 'null');
      
      if (user) {
        loadUserData(user.uid);
      }
    });
    
    return true;
  } catch (error) {
    console.error('[Firebase] Initialization error:', error);
    return false;
  }
}

/**
 * Load Firebase SDK dynamically
 */
function loadFirebaseSDK() {
  const scripts = [
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js'
  ];
  
  let loaded = 0;
  scripts.forEach(src => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => {
      loaded++;
      if (loaded === scripts.length) {
        initFirebaseDatabase();
      }
    };
    script.onerror = () => {
      console.error('[Firebase] Failed to load:', src);
    };
    document.head.appendChild(script);
  });
}

// ==================== AUTH FUNCTIONS ====================

/**
 * Sign in anonymously (for quick access)
 */
async function signInAnonymously() {
  try {
    const result = await firebase.auth().signInAnonymously();
    console.log('[Firebase] Anonymous sign-in:', result.user.uid);
    return result.user;
  } catch (error) {
    console.error('[Firebase] Anonymous sign-in error:', error);
    throw error;
  }
}

/**
 * Sign in with email/password
 */
async function signInWithEmail(email, password) {
  try {
    const result = await firebase.auth().signInWithEmailAndPassword(email, password);
    console.log('[Firebase] Email sign-in:', result.user.uid);
    return result.user;
  } catch (error) {
    console.error('[Firebase] Email sign-in error:', error);
    throw error;
  }
}

/**
 * Register new user
 */
async function registerUser(email, password, name) {
  try {
    const result = await firebase.auth().createUserWithEmailAndPassword(email, password);
    
    // Save user profile
    await saveUserProfile(result.user.uid, {
      name: name,
      email: email,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
    
    console.log('[Firebase] User registered:', result.user.uid);
    return result.user;
  } catch (error) {
    console.error('[Firebase] Registration error:', error);
    throw error;
  }
}

/**
 * Sign out
 */
function signOut() {
  return firebase.auth().signOut();
}

// ==================== USER DATA ====================

/**
 * Save/Update user profile
 */
function saveUserProfile(uid, data) {
  if (!dbState.initialized || !uid) return Promise.reject('Not initialized');
  
  return dbState.database.ref(`users/${uid}`).update(data);
}

/**
 * Load user data
 */
function loadUserData(uid) {
  if (!dbState.initialized || !uid) return;
  
  return dbState.database.ref(`users/${uid}`).once('value')
    .then(snapshot => snapshot.val());
}

// ==================== DOCUMENTS ====================

/**
 * Save document to database
 */
function saveDocument(docData) {
  if (!dbState.initialized) return Promise.reject('Not initialized');
  
  const uid = dbState.currentUser?.uid || 'anonymous';
  const docRef = dbState.database.ref('documents').push();
  
  const data = {
    id: docRef.key,
    name: docData.name || 'Untitled',
    type: docData.type || 'unknown',
    url: docData.url || '',
    userId: uid,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    ...docData
  };
  
  return docRef.set(data).then(() => data.id);
}

/**
 * Get all documents for current user
 */
function getUserDocuments(limit = 50) {
  if (!dbState.initialized) return Promise.reject('Not initialized');
  
  const uid = dbState.currentUser?.uid || 'anonymous';
  
  return dbState.database.ref('documents')
    .orderByChild('userId')
    .equalTo(uid)
    .limitToLast(limit)
    .once('value')
    .then(snapshot => {
      const docs = [];
      snapshot.forEach(child => {
        docs.push({ id: child.key, ...child.val() });
      });
      return docs.reverse(); // Newest first
    });
}

/**
 * Delete document
 */
function deleteDocument(docId) {
  if (!dbState.initialized) return Promise.reject('Not initialized');
  
  return dbState.database.ref(`documents/${docId}`).remove();
}

/**
 * Listen to documents changes (realtime)
 */
function onDocumentsChange(callback) {
  if (!dbState.initialized) return;
  
  const uid = dbState.currentUser?.uid || 'anonymous';
  const ref = dbState.database.ref('documents').orderByChild('userId').equalTo(uid);
  
  const listener = ref.on('value', (snapshot) => {
    const docs = [];
    snapshot.forEach(child => {
      docs.push({ id: child.key, ...child.val() });
    });
    callback(docs.reverse());
  });
  
  dbState.listeners['documents'] = { ref, listener };
  return listener;
}

// ==================== OCR RESULTS ====================

/**
 * Save OCR result to database
 */
function saveOcrResult(ocrData) {
  if (!dbState.initialized) return Promise.reject('Not initialized');
  
  const uid = dbState.currentUser?.uid || 'anonymous';
  const ocrRef = dbState.database.ref('ocr_results').push();
  
  const data = {
    id: ocrRef.key,
    text: ocrData.text || '',
    imageUrl: ocrData.imageUrl || '',
    language: ocrData.language || 'unknown',
    pdfUrl: ocrData.pdfUrl || '',
    jsonData: ocrData.jsonData || null,
    userId: uid,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  };
  
  return ocrRef.set(data).then(() => data.id);
}

/**
 * Get OCR history for current user
 */
function getOcrHistory(limit = 30) {
  if (!dbState.initialized) return Promise.reject('Not initialized');
  
  const uid = dbState.currentUser?.uid || 'anonymous';
  
  return dbState.database.ref('ocr_results')
    .orderByChild('userId')
    .equalTo(uid)
    .limitToLast(limit)
    .once('value')
    .then(snapshot => {
      const results = [];
      snapshot.forEach(child => {
        results.push({ id: child.key, ...child.val() });
      });
      return results.reverse();
    });
}

/**
 * Delete OCR result
 */
function deleteOcrResult(ocrId) {
  if (!dbState.initialized) return Promise.reject('Not initialized');
  
  return dbState.database.ref(`ocr_results/${ocrId}`).remove();
}

/**
 * Search OCR results by text
 */
function searchOcrResults(query, limit = 20) {
  if (!dbState.initialized) return Promise.reject('Not initialized');
  
  const uid = dbState.currentUser?.uid || 'anonymous';
  
  // Note: Realtime Database doesn't support full-text search natively
  // This gets all results and filters client-side
  return getOcrHistory(100).then(results => {
    const lowerQuery = query.toLowerCase();
    return results.filter(r => 
      r.text && r.text.toLowerCase().includes(lowerQuery)
    ).slice(0, limit);
  });
}

// ==================== ID CARDS ====================

/**
 * Save ID card data
 */
function saveIdCard(cardData) {
  if (!dbState.initialized) return Promise.reject('Not initialized');
  
  const uid = dbState.currentUser?.uid || 'anonymous';
  const cardRef = dbState.database.ref('idcards').push();
  
  const data = {
    id: cardRef.key,
    frontUrl: cardData.frontUrl || '',
    backUrl: cardData.backUrl || '',
    layoutMode: cardData.layoutMode || 'stacked',
    userId: uid,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  };
  
  return cardRef.set(data).then(() => data.id);
}

/**
 * Get ID cards history
 */
function getIdCardsHistory(limit = 20) {
  if (!dbState.initialized) return Promise.reject('Not initialized');
  
  const uid = dbState.currentUser?.uid || 'anonymous';
  
  return dbState.database.ref('idcards')
    .orderByChild('userId')
    .equalTo(uid)
    .limitToLast(limit)
    .once('value')
    .then(snapshot => {
      const cards = [];
      snapshot.forEach(child => {
        cards.push({ id: child.key, ...child.val() });
      });
      return cards.reverse();
    });
}

// ==================== PRINT QUEUE ====================

/**
 * Add item to print queue
 */
function addToPrintQueue(itemData) {
  if (!dbState.initialized) return Promise.reject('Not initialized');
  
  const uid = dbState.currentUser?.uid || 'anonymous';
  const itemRef = dbState.database.ref('print_queue').push();
  
  const data = {
    id: itemRef.key,
    documentName: itemData.documentName || 'Document',
    type: itemData.type || 'document',
    status: 'pending', // pending, printing, completed, failed
    copies: itemData.copies || 1,
    settings: itemData.settings || {},
    userId: uid,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  };
  
  return itemRef.set(data).then(() => data.id);
}

/**
 * Update print queue item status
 */
function updatePrintQueueStatus(itemId, status) {
  if (!dbState.initialized) return Promise.reject('Not initialized');
  
  return dbState.database.ref(`print_queue/${itemId}/status`).set(status);
}

/**
 * Get print queue for current user
 */
function getPrintQueue() {
  if (!dbState.initialized) return Promise.reject('Not initialized');
  
  const uid = dbState.currentUser?.uid || 'anonymous';
  
  return dbState.database.ref('print_queue')
    .orderByChild('userId')
    .equalTo(uid)
    .limitToLast(100)
    .once('value')
    .then(snapshot => {
      const items = [];
      snapshot.forEach(child => {
        items.push({ id: child.key, ...child.val() });
      });
      return items.reverse();
    });
}

/**
 * Clear completed print queue items
 */
function clearCompletedPrintItems() {
  if (!dbState.initialized) return Promise.reject('Not initialized');
  
  const uid = dbState.currentUser?.uid || 'anonymous';
  
  return dbState.database.ref('print_queue')
    .orderByChild('userId')
    .equalTo(uid)
    .once('value')
    .then(snapshot => {
      const updates = {};
      snapshot.forEach(child => {
        if (child.val().status === 'completed') {
          updates[`print_queue/${child.key}`] = null;
        }
      });
      return dbState.database.ref().update(updates);
    });
}

// ==================== SYNC & OFFLINE ====================

/**
 * Enable offline persistence
 */
function enableOfflinePersistence() {
  if (!dbState.initialized) return false;
  
  try {
    dbState.database.persistenceEnabled = true;
    console.log('[Firebase] Offline persistence enabled');
    return true;
  } catch (error) {
    console.warn('[Firebase] Offline persistence error:', error);
    return false;
  }
}

/**
 * Check connection status
 */
function onConnectionStatus(callback) {
  if (!dbState.initialized) return;
  
  const connectedRef = dbState.database.ref('.info/connected');
  connectedRef.on('value', (snapshot) => {
    callback(snapshot.val() === true);
  });
}

// ==================== CLEANUP ====================

/**
 * Remove all listeners
 */
function removeAllListeners() {
  Object.values(dbState.listeners).forEach(({ ref, listener }) => {
    if (ref && listener) {
      ref.off('value', listener);
    }
  });
  dbState.listeners = {};
}

/**
 * Cleanup on page unload
 */
window.addEventListener('beforeunload', () => {
  removeAllListeners();
});

// Export for use
window.FirebaseDB = {
  init: initFirebaseDatabase,
  auth: {
    signInAnonymously,
    signInWithEmail,
    registerUser,
    signOut
  },
  users: {
    saveProfile: saveUserProfile,
    load: loadUserData
  },
  documents: {
    save: saveDocument,
    getAll: getUserDocuments,
    delete: deleteDocument,
    onChange: onDocumentsChange
  },
  ocr: {
    save: saveOcrResult,
    getHistory: getOcrHistory,
    delete: deleteOcrResult,
    search: searchOcrResults
  },
  idcards: {
    save: saveIdCard,
    getHistory: getIdCardsHistory
  },
  printQueue: {
    add: addToPrintQueue,
    updateStatus: updatePrintQueueStatus,
    get: getPrintQueue,
    clearCompleted: clearCompletedPrintItems
  },
  sync: {
    enableOffline: enableOfflinePersistence,
    onConnectionStatus
  },
  cleanup: removeAllListeners
};

console.log('[Firebase] Module loaded');
