/**
 * MadMusings Article Swipe
 * Smooth horizontal swipe navigation between articles in the same issue.
 *
 * Interaction model:
 *   • Touch/mouse drag — tracks finger/cursor live via CSS transform
 *   • Velocity-aware throw — fast flick snaps even before threshold
 *   • Arrow-key navigation (← prev / → next)
 *   • Escape key / click outside — cancels a drag in progress
 *
 * No external dependencies. Vanilla ES2017.
 */

( function () {
    'use strict';

    /* ------------------------------------------------------------------ */
    /* Config (overridden by wp_localize_script data)                      */
    /* ------------------------------------------------------------------ */
    const cfg = Object.assign(
        { prev: null, next: null, threshold: 80, duration: 380 },
        window.madSwipe || {}
    );

    /* ------------------------------------------------------------------ */
    /* DOM refs                                                             */
    /* ------------------------------------------------------------------ */
    const stage   = document.getElementById( 'mm-swipe-stage' );
    const current = document.getElementById( 'mm-panel-current' );
    const panelPrev = document.getElementById( 'mm-panel-prev' );
    const panelNext = document.getElementById( 'mm-panel-next' );

    if ( ! stage || ! current ) return;

    /* ------------------------------------------------------------------ */
    /* State                                                                */
    /* ------------------------------------------------------------------ */
    let dragging   = false;
    let startX     = 0;
    let startY     = 0;
    let lastX      = 0;
    let lastT      = 0;       // timestamp of last pointer move
    let velocityX  = 0;       // px / ms
    let deltaX     = 0;       // accumulated horizontal drag
    let axis       = null;    // 'x' | 'y' | null  (locked after first 10 px)
    let animating  = false;

    /* ------------------------------------------------------------------ */
    /* Pointer helpers                                                      */
    /* ------------------------------------------------------------------ */
    function clientX( e ) {
        return e.touches ? e.touches[0].clientX : e.clientX;
    }
    function clientY( e ) {
        return e.touches ? e.touches[0].clientY : e.clientY;
    }

    /* ------------------------------------------------------------------ */
    /* Transform helpers                                                    */
    /* ------------------------------------------------------------------ */

    /**
     * Move the current panel and its ghost neighbours live during drag.
     * Ghost panels slide in from the edges to give a peek effect.
     */
    function applyLiveDrag( dx ) {
        const vw   = window.innerWidth;
        const peek = Math.min( Math.abs( dx ) / vw, 1 ); // 0 → 1

        // Current panel tracks finger directly (with slight resistance at boundaries)
        const bounded = boundedDelta( dx );
        setTranslate( current, bounded );

        // Prev panel: starts fully off-screen left (-100 vw), slides in
        if ( panelPrev && bounded > 0 ) {
            const prevPos = -vw + bounded;
            setTranslate( panelPrev, prevPos );
            panelPrev.style.opacity = String( peek );
        }

        // Next panel: starts fully off-screen right (+100 vw), slides in
        if ( panelNext && bounded < 0 ) {
            const nextPos = vw + bounded;
            setTranslate( panelNext, nextPos );
            panelNext.style.opacity = String( peek );
        }
    }

    /**
     * Add rubber-band resistance when swiping toward a missing neighbour.
     */
    function boundedDelta( dx ) {
        if ( dx > 0 && ! cfg.prev ) {
            return rubberBand( dx );
        }
        if ( dx < 0 && ! cfg.next ) {
            return -rubberBand( -dx );
        }
        return dx;
    }

    /** Rubber-band damping: f(x) = x^0.7, feels elastic. */
    function rubberBand( x ) {
        return Math.sign( x ) * Math.pow( Math.abs( x ), 0.7 ) * 0.5;
    }

    function setTranslate( el, px ) {
        if ( el ) el.style.transform = `translateX(${ px }px)`;
    }

    function clearTranslate( el ) {
        if ( el ) el.style.transform = '';
    }

    /* ------------------------------------------------------------------ */
    /* Snap animation                                                       */
    /* ------------------------------------------------------------------ */

    /**
     * Animate to a target offset then navigate (or snap back).
     *
     * @param {string|null} targetUrl  URL to navigate to, or null to snap back.
     * @param {number}      direction  +1 = going to prev (slide right), -1 = going to next.
     */
    function snapTo( targetUrl, direction ) {
        if ( animating ) return;
        animating = true;

        const vw      = window.innerWidth;
        const endPos  = targetUrl ? direction * vw : 0;
        const dur     = cfg.duration;

        // Animate current panel out (or back)
        current.style.transition = `transform ${ dur }ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`;
        setTranslate( current, endPos );

        // Animate ghost panel to fill the screen (or recede)
        if ( targetUrl ) {
            const ghost = direction === 1 ? panelPrev : panelNext;
            if ( ghost ) {
                ghost.style.transition = `transform ${ dur }ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
                                          opacity    ${ dur }ms ease`;
                setTranslate( ghost, 0 );
                ghost.style.opacity = '1';
            }
        } else {
            // Snap back: reset ghost panels
            [ panelPrev, panelNext ].forEach( p => {
                if ( ! p ) return;
                p.style.transition = `transform ${ dur }ms cubic-bezier(0.25, 0.46, 0.45, 0.94),
                                      opacity    ${ dur }ms ease`;
                const off = p === panelPrev ? -vw : vw;
                setTranslate( p, off );
                p.style.opacity = '0';
            } );
        }

        setTimeout( () => {
            if ( targetUrl ) {
                window.location.href = targetUrl;
            } else {
                // Reset everything
                [ current, panelPrev, panelNext ].forEach( p => {
                    if ( ! p ) return;
                    p.style.transition = '';
                    p.style.opacity    = '';
                    clearTranslate( p );
                } );
                animating = false;
            }
        }, targetUrl ? dur + 50 : dur );
    }

    /* ------------------------------------------------------------------ */
    /* Decision: should we navigate?                                        */
    /* ------------------------------------------------------------------ */
    function decide() {
        const absDelta    = Math.abs( deltaX );
        const absVelocity = Math.abs( velocityX );

        // Fast flick — honour even with small distance
        const fastFlick  = absVelocity > 0.5 && absDelta > 20;
        // Slow drag past threshold
        const slowDrag   = absDelta >= cfg.threshold;

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

    /* ------------------------------------------------------------------ */
    /* Drag start                                                           */
    /* ------------------------------------------------------------------ */
    function onDragStart( e ) {
        if ( animating ) return;
        // Ignore if starting on an interactive element
        if ( e.target.closest( 'a, button, input, textarea, select, [contenteditable]' ) ) return;

        dragging  = true;
        axis      = null;
        deltaX    = 0;
        velocityX = 0;
        startX    = clientX( e );
        startY    = clientY( e );
        lastX     = startX;
        lastT     = performance.now();

        // Remove any lingering transitions so drag is immediate
        [ current, panelPrev, panelNext ].forEach( p => {
            if ( p ) p.style.transition = 'none';
        } );

        // Init ghost panels off-screen
        if ( panelPrev ) {
            setTranslate( panelPrev, -window.innerWidth );
            panelPrev.style.opacity = '0';
        }
        if ( panelNext ) {
            setTranslate( panelNext, window.innerWidth );
            panelNext.style.opacity = '0';
        }
    }

    /* ------------------------------------------------------------------ */
    /* Drag move                                                            */
    /* ------------------------------------------------------------------ */
    function onDragMove( e ) {
        if ( ! dragging ) return;

        const cx = clientX( e );
        const cy = clientY( e );
        const dx = cx - startX;
        const dy = cy - startY;

        // Lock to an axis once we've moved 10 px
        if ( axis === null ) {
            if ( Math.abs( dx ) < 10 && Math.abs( dy ) < 10 ) return;
            axis = Math.abs( dx ) >= Math.abs( dy ) ? 'x' : 'y';
        }

        if ( axis !== 'x' ) return;

        // Prevent page scroll while swiping horizontally
        if ( e.cancelable ) e.preventDefault();

        // Velocity calculation
        const now    = performance.now();
        const dt     = now - lastT;
        if ( dt > 0 ) {
            velocityX = ( cx - lastX ) / dt;
        }
        lastX = cx;
        lastT = now;

        deltaX = dx;
        applyLiveDrag( deltaX );
    }

    /* ------------------------------------------------------------------ */
    /* Drag end                                                             */
    /* ------------------------------------------------------------------ */
    function onDragEnd() {
        if ( ! dragging ) return;
        dragging = false;
        if ( axis !== 'x' ) return;
        decide();
    }

    /* ------------------------------------------------------------------ */
    /* Cancel drag (e.g. Escape key)                                       */
    /* ------------------------------------------------------------------ */
    function cancelDrag() {
        if ( ! dragging ) return;
        dragging = false;
        snapTo( null, 0 );
    }

    /* ------------------------------------------------------------------ */
    /* Keyboard navigation                                                  */
    /* ------------------------------------------------------------------ */
    document.addEventListener( 'keydown', function ( e ) {
        if ( animating ) return;
        if ( e.key === 'ArrowLeft'  && cfg.prev ) {
            snapTo( cfg.prev.url, 1 );
        }
        if ( e.key === 'ArrowRight' && cfg.next ) {
            snapTo( cfg.next.url, -1 );
        }
        if ( e.key === 'Escape' ) {
            cancelDrag();
        }
    } );

    /* ------------------------------------------------------------------ */
    /* Event listeners                                                      */
    /* ------------------------------------------------------------------ */

    // Touch
    stage.addEventListener( 'touchstart',  onDragStart, { passive: true } );
    stage.addEventListener( 'touchmove',   onDragMove,  { passive: false } );
    stage.addEventListener( 'touchend',    onDragEnd,   { passive: true } );
    stage.addEventListener( 'touchcancel', cancelDrag,  { passive: true } );

    // Mouse (desktop drag)
    stage.addEventListener( 'mousedown', onDragStart );
    window.addEventListener( 'mousemove', onDragMove );
    window.addEventListener( 'mouseup',   onDragEnd );
    window.addEventListener( 'blur',      cancelDrag );   // e.g. alt-tab mid-drag

    /* ------------------------------------------------------------------ */
    /* Visual hint — show arrows briefly on first visit                    */
    /* ------------------------------------------------------------------ */
    ( function showHint() {
        const HINT_KEY = 'mm_swipe_hint_seen';
        if ( localStorage.getItem( HINT_KEY ) ) return;
        localStorage.setItem( HINT_KEY, '1' );

        const hint = document.createElement( 'div' );
        hint.id    = 'mm-swipe-hint';
        hint.setAttribute( 'aria-hidden', 'true' );
        hint.innerHTML = [
            cfg.prev ? '<span class="mm-hint__arrow mm-hint__arrow--left">&#8592;</span>' : '',
            '<span class="mm-hint__text">Swipe to browse articles</span>',
            cfg.next ? '<span class="mm-hint__arrow mm-hint__arrow--right">&#8594;</span>' : '',
        ].join( '' );

        document.body.appendChild( hint );

        // Auto-dismiss after 2.8 s
        setTimeout( () => {
            hint.classList.add( 'mm-hint--fade' );
            setTimeout( () => hint.remove(), 600 );
        }, 2800 );
    }() );

} )();
