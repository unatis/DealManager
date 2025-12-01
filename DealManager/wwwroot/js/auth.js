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

async function doAuth(kind) {
    errorEl.textContent = '';

    const fd = new FormData(form);
    const email = fd.get('email')?.trim();
    const password = fd.get('password')?.trim();

    if (!email || !password) {
        errorEl.textContent = 'Please fill in email and password';
        return;
    }

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
            return;
        }
        if (password !== passwordConfirm) {
            errorEl.textContent = 'Passwords do not match';
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
    }
}

// ================== обработчики кнопок ==================

btnSignIn.addEventListener('click', async () => {
    if (mode !== 'login') {
        setMode('login');
        return;
    }
    await doAuth('login');
});

btnSignUp.addEventListener('click', async () => {
    if (mode !== 'signup') {
        setMode('signup');
        return;
    }
    await doAuth('signup');
});

form.addEventListener('submit', async e => {
    e.preventDefault();
    await doAuth(mode);
});

setMode('login');
console.log('auth.js loaded');
