const form = document.getElementById('authForm');
const errorEl = document.getElementById('authError');
const signupExtra = document.querySelector('.signup-extra');
const btnSignIn = document.getElementById('btnSignIn');
const btnSignUp = document.getElementById('btnSignUp');
const authTitle = document.getElementById('authTitle');

let mode = 'login';

// ================== режимы (login / signup) ==================

function setMode(newMode) {
    mode = newMode;
    const isSignup = mode === 'signup';

    authTitle.textContent = isSignup ? 'Sign up' : 'Sign in';
    signupExtra.classList.toggle('visible', isSignup);

    btnSignIn.classList.toggle('active', mode === 'login');
    btnSignUp.classList.toggle('active', mode === 'signup');

    errorEl.textContent = '';
}

// ================== разбор ответа: token / email / userName / portfolio ==================

function extractAuthData(raw) {
    // ожидаем объект вида:
    // { token, email, portfolio, userName } или
    // { Token, Email, Portfolio, UserName }
    if (!raw || typeof raw !== 'object') {
        return { token: null, email: null, userName: null, portfolio: null };
    }

    const token = raw.token ?? raw.Token ?? null;
    const email = raw.email ?? raw.Email ?? null;
    const userName = raw.userName ?? raw.UserName ?? null;
    const portfolio = raw.portfolio ?? raw.Portfolio ?? null;

    return { token, email, userName, portfolio };
}

function finishLogin(raw) {
    const { token, email, userName, portfolio } = extractAuthData(raw);

    console.log('Auth response:', raw);
    console.log('Parsed token:', token);

    if (!token) {
        console.error('Cannot find token in server response');
        errorEl.textContent = 'Server did not return token';
        return;
    }

    localStorage.setItem('token', token);
    if (email) {
        localStorage.setItem('email', email);
    }
    if (userName) {
        localStorage.setItem('userName', userName);
    }
    if (portfolio !== null && portfolio !== undefined) {
        localStorage.setItem('portfolio', String(portfolio));
    }

    console.log('Token saved to localStorage:', localStorage.getItem('token'));

    window.location.href = '/index.html';
}

// ================== запросы к API ==================

async function callLogin(email, password) {
    const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });

    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }

    if (!res.ok) {
        if (typeof data === 'string' && data) throw new Error(data);
        if (data && data.message) throw new Error(data.message);
        throw new Error('Login failed');
    }

    return data;
}

function setButtonLoading(button, isLoading) {
    if (isLoading) {
        if (!button.dataset.originalText) {
            button.dataset.originalText = button.textContent.trim();
        }
        button.disabled = true;
        button.innerHTML = '<span class="loading-spinner"></span> Loading...';
    } else {
        button.disabled = false;
        const originalText = button.dataset.originalText || 'Sign in';
        button.textContent = originalText;
        delete button.dataset.originalText;
    }
}

async function doAuth(kind) {
    if (isProcessing) return;
    
    errorEl.textContent = '';

    const fd = new FormData(form);
    const email = fd.get('email')?.trim();
    const password = fd.get('password')?.trim();

    if (!email || !password) {
        errorEl.textContent = 'Please fill in email and password';
        return;
    }

    isProcessing = true;
    const activeButton = kind === 'login' ? btnSignIn : btnSignUp;
    const otherButton = kind === 'login' ? btnSignUp : btnSignIn;
    
    // Disable both buttons and show loading on active one
    setButtonLoading(activeButton, true);
    otherButton.disabled = true;
    
    // Small delay to ensure button state is visible
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        if (kind === 'login') {
            const data = await callLogin(email, password);
            finishLogin(data);
            return;
        }

        // ---------- SIGN UP ----------
        const username = fd.get('username')?.trim();
        const passwordConfirm = fd.get('passwordConfirm')?.trim();

        if (!username) {
            errorEl.textContent = 'Please enter username';
            setButtonLoading(activeButton, false);
            otherButton.disabled = false;
            isProcessing = false;
            return;
        }
        if (password !== passwordConfirm) {
            errorEl.textContent = 'Passwords do not match';
            setButtonLoading(activeButton, false);
            otherButton.disabled = false;
            isProcessing = false;
            return;
        }

        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, username })
        });

        const text = await res.text();
        let regData;
        try {
            regData = JSON.parse(text);
        } catch {
            regData = text;
        }

        if (!res.ok) {
            if (typeof regData === 'string' && regData) throw new Error(regData);
            if (regData && regData.message) throw new Error(regData.message);
            throw new Error('Registration failed');
        }

        // авто-логин после регистрации
        const loginData = await callLogin(email, password);
        finishLogin(loginData);
    } catch (err) {
        console.error(err);
        errorEl.textContent = err.message || 'Network error. Try again later.';
        setButtonLoading(activeButton, false);
        otherButton.disabled = false;
        isProcessing = false;
    }
}

// ================== обработчики кнопок ==================

let isProcessing = false;

btnSignIn.addEventListener('click', async () => {
    if (isProcessing) return;
    if (mode !== 'login') {
        setMode('login');
        return;
    }
    await doAuth('login');
});

btnSignUp.addEventListener('click', async () => {
    if (isProcessing) return;
    if (mode !== 'signup') {
        setMode('signup');
        return;
    }
    await doAuth('signup');
});

form.addEventListener('submit', async e => {
    e.preventDefault();
    if (isProcessing) return;
    await doAuth(mode);
});

setMode('login');
console.log('auth.js loaded');
