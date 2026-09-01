/**
 * Auth sederhana untuk Enterprise Portal.
 *
 * Kredensial mengikuti yang sudah dipakai Drive Connector (public/app.js):
 * username "admin", password "admin". Pengecekan dilakukan di sisi browser,
 * jadi ini pembatas operasional - bukan pengaman data.
 *
 * Status login disimpan di sessionStorage supaya tetap terbawa saat pindah
 * halaman, dan otomatis hilang ketika tab ditutup.
 */
(function (global) {
    'use strict';

    var KEY = 'chickin_admin';
    var USERNAME = 'admin';
    var PASSWORD = 'admin';

    var memoryState = false;     // cadangan kalau sessionStorage diblokir
    var pendingAction = null;
    var onChange = null;

    var $ = function (id) { return document.getElementById(id); };

    // ---------- State ----------
    function isLoggedIn() {
        try {
            return sessionStorage.getItem(KEY) === '1';
        } catch (e) {
            return memoryState;
        }
    }

    function setLoggedIn(value) {
        memoryState = value;
        try {
            if (value) sessionStorage.setItem(KEY, '1');
            else sessionStorage.removeItem(KEY);
        } catch (e) {
            // sessionStorage tidak tersedia - pakai state di memori saja
        }
    }

    function greeting() {
        var jam = new Date().getHours();
        if (jam < 11) return 'Good Morning';
        if (jam < 15) return 'Good Afternoon';
        if (jam < 19) return 'Good Evening';
        return 'Good Night';
    }

    // ---------- Tampilan sidebar ----------
    function updateUI() {
        var masuk = isLoggedIn();

        var initial = $('user-initial');
        var display = $('user-display');
        var salam = $('user-greeting');
        var trigger = $('authBtnTrigger');

        if (initial) initial.textContent = masuk ? 'A' : 'G';
        if (display) display.textContent = masuk ? 'Administrator' : 'Guest';
        if (salam) salam.textContent = greeting();

        if (trigger) {
            var icon = trigger.querySelector('i');
            var label = trigger.querySelector('span');

            trigger.title = masuk ? 'Logout Admin' : 'Admin Login';
            trigger.classList.toggle('active', masuk);
            if (label) label.textContent = masuk ? 'Logout Admin' : 'Login Admin';
            if (icon) icon.setAttribute('data-lucide', masuk ? 'log-out' : 'log-in');
        }

        if (window.lucide) lucide.createIcons();
        if (onChange) onChange(masuk);
    }

    // ---------- Modal ----------
    function openModal() {
        var modal = $('loginModal');
        if (!modal) return;

        var err = $('lg-error');
        if (err) err.style.display = 'none';

        modal.classList.add('show');
        setTimeout(function () {
            var user = $('lg-user');
            if (user) user.focus();
        }, 50);
    }

    function closeModal() {
        var modal = $('loginModal');
        if (modal) modal.classList.remove('show');

        if ($('lg-user')) $('lg-user').value = '';
        if ($('lg-pass')) $('lg-pass').value = '';
        pendingAction = null;
    }

    function submit() {
        var user = ($('lg-user') || {}).value || '';
        var pass = ($('lg-pass') || {}).value || '';

        if (user.trim() !== USERNAME || pass !== PASSWORD) {
            var err = $('lg-error');
            if (err) {
                err.textContent = 'Username atau password salah.';
                err.style.display = 'block';
            }
            if ($('lg-pass')) $('lg-pass').select();
            return;
        }

        var lanjut = pendingAction;
        setLoggedIn(true);
        closeModal();
        updateUI();
        if (lanjut) lanjut();
    }

    function logout() {
        setLoggedIn(false);
        updateUI();
    }

    /** Jalankan aksi kalau sudah login; kalau belum, minta login dulu. */
    function require(action) {
        if (isLoggedIn()) {
            action();
            return;
        }
        pendingAction = action;
        openModal();
    }

    /**
     * @param {object} opts
     *   onChange(masuk) - dipanggil tiap status login berubah / saat init.
     */
    function init(opts) {
        onChange = (opts && opts.onChange) || null;

        var trigger = $('authBtnTrigger');
        if (trigger) {
            trigger.addEventListener('click', function (e) {
                e.preventDefault();
                if (isLoggedIn()) logout();
                else openModal();
            });
        }

        if ($('lg-submit')) $('lg-submit').addEventListener('click', submit);
        if ($('lg-cancel')) $('lg-cancel').addEventListener('click', closeModal);

        ['lg-user', 'lg-pass'].forEach(function (id) {
            var el = $(id);
            if (!el) return;
            el.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') submit();
            });
        });

        var modal = $('loginModal');
        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target === modal) closeModal();
            });
        }

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeModal();
        });

        updateUI();
    }

    global.Auth = {
        init: init,
        require: require,
        isLoggedIn: isLoggedIn,
        logout: logout,
        updateUI: updateUI,
        username: USERNAME
    };
})(window);
