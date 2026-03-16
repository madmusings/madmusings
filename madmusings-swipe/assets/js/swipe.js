/**
 * MadMusings Article Swipe — v1.1.0
 *
 * Architecture
 * ────────────
 * PHP outputs two ghost panels inside #mm-overlay-layer (position:fixed).
 * JS wraps all non-overlay body children in #mm-content after DOM ready.
 * Swipe transforms #mm-content (slides the full page) while ghost panels
 * slide in from the edges inside their own fixed overlay — so Elementor's
 * fixed headers and sticky elements are never disrupted.
 *
 * Flow
 * ────
 * 1. Finger down  → lock drag axis, strip transitions from panels
 * 2. Finger move  → translateX(#mm-content) + ghost panel peeks in
 * 3. Finger up    → velocity-aware: snap to next/prev URL or snap back
 * 4. Navigate     → window.location.href, with a location.replace fallback
 */

( function () {
    'use strict';

    /* ── Config ─────────────────────────────────────────────────────── */
    const cfg = Object.assign(
        { prev: null, next: null, threshold: 80, duration: 350 },
        window.madSwipe || {}
    );

    /* ── DOM ─────────────────────────────────────────────────────────── */
    const overlayLayer = document.getElementById( 'mm-overlay-layer' );
    const panelPrev    = document.getElementById( 'mm-panel-prev' );
    const panelNext    = document.getElementById( 'mm-panel-next' );

    // The plugin didn't output anything for this page — bail.
    if ( ! overlayLayer ) return;

    /* ── Wrap body content in #mm-content ───────────────────────────── *
     *
     * We move every direct child of <body> — except #mm-overlay-layer
     * and any position:fixed elements (Elementor sticky header, etc.) —
     * into a new #mm-content div. Transforms are then applied to
     * #mm-content, leaving truly fixed elements untouched.
     *
     * Runs after window.load so Elementor's own DOM setup is complete.
     */
    let contentEl = null;

    function buildWrapper() {
        if ( contentEl ) return; // already done

        contentEl      = document.createElement( 'div' );
        contentEl.id   = 'mm-content';

        const body     = document.body;
        const children = Array.from( body.childNodes );

        children.forEach( function ( node ) {
            // Keep the overlay and its siblings in <body> directly,
            // and keep any top-level position:fixed elements (sticky headers)
            // so they remain truly viewport-fixed during the animation.
            if ( node === overlayLayer ) return;

            if ( node.nodeType === Node.ELEMENT_NODE ) {
                try {
                    const pos = window.getComputedStyle( node ).position;
                    if ( pos === 'fixed' ) return; // leave Elementor sticky headers alone
                } catch ( e ) { /* ignore */ }
            }

            contentEl.appendChild( node );
        } );

        // Insert wrapper as the first child of body
        body.insertBefore( contentEl, body.firstChild );
    }

    // Use window.load to ensure Elementor JS has fully initialised.
    if ( document.readyState === 'complete' ) {
        buildWrapper();
    } else {
        window.addEventListener( 'load', buildWrapper );
    }

    /* ── Helpers ─────────────────────────────────────────────────────── */
    const vw = () => window.innerWidth;

    function setX( el, px ) {
        if ( el ) el.style.transform = 'translateX(' + px + 'px)';
    }

    function clearX( el ) {
        if ( el ) { el.style.transform = ''; el.style.transition = ''; }
    }

    /** Rubber-band damping when swiping past the last article. */
    function rubberBand( x ) {
        return Math.sign( x ) * Math.pow( Math.abs( x ), 0.65 ) * 0.45;
    }

    /** Apply drag resistance when there's no neighbour in that direction. */
    function boundedDelta( dx ) {
        if ( dx > 0 && ! cfg.prev ) return  rubberBand( dx );
        if ( dx < 0 && ! cfg.next ) return -rubberBand( -dx );
        return dx;
    }

    /* ── Live drag ───────────────────────────────────────────────────── */
    function applyLiveDrag( dx ) {
        if ( ! contentEl ) return;

        const bounded = boundedDelta( dx );
        const W       = vw();

        // Slide the page content with the finger
        setX( contentEl, bounded );

        if ( bounded > 0 && panelPrev ) {
            // Prev panel peeks in from the left
            setX( panelPrev, -W + bounded );
            panelPrev.style.opacity = String( Math.min( bounded / W, 1 ) );
        } else if ( bounded < 0 && panelNext ) {
            // Next panel peeks in from the right
            setX( panelNext, W + bounded );
            panelNext.style.opacity = String( Math.min( -bounded / W, 1 ) );
        }
    }

    /* ── Snap / navigate ─────────────────────────────────────────────── */
    let animating = false;

    /**
     * @param {string|null} targetUrl  Navigate here, or null to snap back.
     * @param {1|-1|0}      direction  +1 = going prev, -1 = going next.
     */
    function snapTo( targetUrl, direction ) {
        if ( animating ) return;
        animating = true;

        if ( ! contentEl ) {
            // Wrapper not ready yet — navigate directly without animation
            if ( targetUrl ) window.location.href = targetUrl;
            animating = false;
            return;
        }

        const W      = vw();
        const dur    = cfg.duration;
        const ease   = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        const trans  = 'transform ' + dur + 'ms ' + ease;

        if ( targetUrl ) {
            // Animate content off screen
            contentEl.style.transition = trans;
            setX( contentEl, direction * W );

            // Bring ghost panel to centre
            const ghost = direction === 1 ? panelPrev : panelNext;
            if ( ghost ) {
                ghost.style.transition = trans + ', opacity ' + dur + 'ms ease';
                setX( ghost, 0 );
                ghost.style.opacity = '1';
            }

            // Navigate after animation completes
            const navigate = function () {
                try {
                    window.location.href = targetUrl;
                } catch ( e ) {
                    window.location.replace( targetUrl );
                }
            };

            // Primary: fire after animation
            setTimeout( navigate, dur + 60 );

            // Fallback: if the primary somehow stalls, force navigation
            setTimeout( navigate, dur + 1200 );

        } else {
            // Snap back to original position
            contentEl.style.transition = trans;
            setX( contentEl, 0 );

            [ panelPrev, panelNext ].forEach( function ( p ) {
                if ( ! p ) return;
                p.style.transition = trans + ', opacity ' + dur + 'ms ease';
                setX( p, p === panelPrev ? -W : W );
                p.style.opacity = '0';
            } );

            setTimeout( function () {
                clearX( contentEl );
                [ panelPrev, panelNext ].forEach( clearX );
                animating = false;
            }, dur + 20 );
        }
    }

    /* ── Decision ────────────────────────────────────────────────────── */
    function decide() {
        const absDelta    = Math.abs( deltaX );
        const absVelocity = Math.abs( velocityX );

        const fastFlick = absVelocity > 0.45 && absDelta > 15;
        const slowDrag  = absDelta >= cfg.threshold;

        if ( ! fastFlick && ! slowDrag ) {
            snapTo( null, 0 );
            return;
        }

        if ( deltaX > 0 && cfg.prev ) {
            snapTo( cfg.prev.url, 1 );
        } else if ( deltaX < 0 && cfg.next ) {
            snapTo( cfg.next.url, -1 );
        } else {
            snapTo( null, 0 );
        }
    }

    /* ── Drag state ──────────────────────────────────────────────────── */
    let dragging  = false;
    let startX    = 0;
    let startY    = 0;
    let lastX     = 0;
    let lastT     = 0;
    let velocityX = 0;
    let deltaX    = 0;
    let axis      = null;  // 'x' | 'y' | null

    function getX( e ) { return e.touches ? e.touches[0].clientX : e.clientX; }
    function getY( e ) { return e.touches ? e.touches[0].clientY : e.clientY; }

    /* ── Drag handlers ───────────────────────────────────────────────── */
    function onStart( e ) {
        if ( animating ) return;
        // Don't hijack taps on interactive elements
        if ( e.target.closest( 'a, button, input, textarea, select, [contenteditable]' ) ) return;

        dragging  = true;
        axis      = null;
        deltaX    = 0;
        velocityX = 0;
        startX    = getX( e );
        startY    = getY( e );
        lastX     = startX;
        lastT     = performance.now();

        // Kill transitions so drag is immediate
        if ( contentEl ) contentEl.style.transition = 'none';
        [ panelPrev, panelNext ].forEach( function ( p ) {
            if ( p ) p.style.transition = 'none';
        } );

        // Park ghost panels off-screen
        if ( panelPrev ) { setX( panelPrev, -vw() ); panelPrev.style.opacity = '0'; }
        if ( panelNext ) { setX( panelNext,  vw() ); panelNext.style.opacity = '0'; }

        document.body.classList.add( 'mm-dragging' );
    }

    function onMove( e ) {
        if ( ! dragging ) return;

        const cx = getX( e );
        const cy = getY( e );
        const dx = cx - startX;
        const dy = cy - startY;

        // Lock axis after 10 px of movement
        if ( axis === null ) {
            if ( Math.abs( dx ) < 10 && Math.abs( dy ) < 10 ) return;
            axis = Math.abs( dx ) >= Math.abs( dy ) ? 'x' : 'y';
        }

        if ( axis !== 'x' ) return;

        // Prevent vertical page scroll during horizontal swipe
        if ( e.cancelable ) e.preventDefault();

        // Running velocity
        const now = performance.now();
        const dt  = now - lastT;
        if ( dt > 0 ) velocityX = ( cx - lastX ) / dt;
        lastX = cx;
        lastT = now;

        deltaX = dx;
        applyLiveDrag( deltaX );
    }

    function onEnd() {
        if ( ! dragging ) return;
        dragging = false;
        document.body.classList.remove( 'mm-dragging' );
        if ( axis !== 'x' ) return;
        decide();
    }

    function onCancel() {
        if ( ! dragging ) return;
        dragging = false;
        document.body.classList.remove( 'mm-dragging' );
        snapTo( null, 0 );
    }

    /* ── Event listeners ─────────────────────────────────────────────── */

    // Touch (mobile)
    document.addEventListener( 'touchstart',  onStart,  { passive: true } );
    document.addEventListener( 'touchmove',   onMove,   { passive: false } );
    document.addEventListener( 'touchend',    onEnd,    { passive: true } );
    document.addEventListener( 'touchcancel', onCancel, { passive: true } );

    // Mouse (desktop drag)
    document.addEventListener( 'mousedown', onStart );
    window.addEventListener(   'mousemove', onMove );
    window.addEventListener(   'mouseup',   onEnd );
    window.addEventListener(   'blur',      onCancel );

    /* ── Keyboard navigation ─────────────────────────────────────────── */
    document.addEventListener( 'keydown', function ( e ) {
        if ( animating ) return;
        // Don't fire inside text inputs
        if ( e.target.matches( 'input, textarea, select, [contenteditable]' ) ) return;

        if ( e.key === 'ArrowLeft'  && cfg.prev ) snapTo( cfg.prev.url,  1 );
        if ( e.key === 'ArrowRight' && cfg.next ) snapTo( cfg.next.url, -1 );
        if ( e.key === 'Escape' )                 onCancel();
    } );

    /* ── First-visit hint ────────────────────────────────────────────── */
    ( function showHint() {
        const KEY = 'mm_swipe_hint_v2';
        if ( sessionStorage.getItem( KEY ) ) return;
        sessionStorage.setItem( KEY, '1' );

        const hint = document.createElement( 'div' );
        hint.id    = 'mm-swipe-hint';
        hint.setAttribute( 'aria-hidden', 'true' );

        const parts = [];
        if ( cfg.prev ) parts.push( '<span class="mm-hint__arrow">&#8592;</span>' );
        parts.push( '<span class="mm-hint__text">Swipe to browse articles</span>' );
        if ( cfg.next ) parts.push( '<span class="mm-hint__arrow">&#8594;</span>' );
        hint.innerHTML = parts.join( '' );

        document.body.appendChild( hint );

        setTimeout( function () {
            hint.classList.add( 'mm-hint--fade' );
            setTimeout( function () { hint.remove(); }, 600 );
        }, 2800 );
    }() );

} )();
