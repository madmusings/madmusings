<?php
/**
 * Plugin Name:  MadMusings Article Swipe
 * Plugin URI:   https://madmusings.com
 * Description:  Smooth horizontal swipe navigation between articles in the same magazine issue.
 * Version:      1.1.0
 * Author:       MadMusings
 * License:      GPL-2.0-or-later
 * Text Domain:  madmusings-swipe
 *
 * Requires:     WordPress 6.0+, Elementor Pro
 */

defined( 'ABSPATH' ) || exit;

define( 'MADMUSINGS_SWIPE_VERSION', '1.1.0' );
define( 'MADMUSINGS_SWIPE_DIR',     plugin_dir_path( __FILE__ ) );
define( 'MADMUSINGS_SWIPE_URL',     plugin_dir_url( __FILE__ ) );

/* -----------------------------------------------------------------------
 * 1. TAXONOMY — "issue"
 * Register a custom taxonomy so articles can be grouped by magazine issue.
 * If you already have an "issue" taxonomy, delete this section and change
 * the two 'issue' references in madmusings_get_issue_neighbours() to your
 * existing taxonomy slug.
 * --------------------------------------------------------------------- */
add_action( 'init', 'madmusings_register_issue_taxonomy' );
function madmusings_register_issue_taxonomy() {
    register_taxonomy(
        'issue',
        'post',
        [
            'label'        => __( 'Issue', 'madmusings-swipe' ),
            'labels'       => [
                'name'          => __( 'Issues', 'madmusings-swipe' ),
                'singular_name' => __( 'Issue', 'madmusings-swipe' ),
                'add_new_item'  => __( 'Add New Issue', 'madmusings-swipe' ),
                'edit_item'     => __( 'Edit Issue', 'madmusings-swipe' ),
            ],
            'hierarchical' => true,
            'public'       => true,
            'show_in_rest' => true,
            'rewrite'      => [ 'slug' => 'issue' ],
        ]
    );
}

/* -----------------------------------------------------------------------
 * 2. ENQUEUE assets only on single posts that belong to an issue
 * --------------------------------------------------------------------- */
add_action( 'wp_enqueue_scripts', 'madmusings_swipe_enqueue' );
function madmusings_swipe_enqueue() {
    if ( ! is_singular( 'post' ) ) {
        return;
    }

    $neighbours = madmusings_get_issue_neighbours( get_the_ID() );

    if ( empty( $neighbours['prev'] ) && empty( $neighbours['next'] ) ) {
        return;
    }

    wp_enqueue_style(
        'madmusings-swipe',
        MADMUSINGS_SWIPE_URL . 'assets/css/swipe.css',
        [],
        MADMUSINGS_SWIPE_VERSION
    );

    wp_enqueue_script(
        'madmusings-swipe',
        MADMUSINGS_SWIPE_URL . 'assets/js/swipe.js',
        [],
        MADMUSINGS_SWIPE_VERSION,
        true
    );

    wp_localize_script( 'madmusings-swipe', 'madSwipe', [
        'prev'      => $neighbours['prev'],
        'next'      => $neighbours['next'],
        'threshold' => 80,
        'duration'  => 350,
    ] );
}

/* -----------------------------------------------------------------------
 * 3. HELPER — find previous and next articles in the same issue
 * --------------------------------------------------------------------- */
function madmusings_get_issue_neighbours( int $post_id ): array {
    $result = [ 'prev' => null, 'next' => null ];

    $issues = wp_get_post_terms( $post_id, 'issue', [ 'fields' => 'ids' ] );
    if ( is_wp_error( $issues ) || empty( $issues ) ) {
        return $result;
    }

    $issue_id = (int) $issues[0];

    $posts_in_issue = get_posts( [
        'post_type'      => 'post',
        'post_status'    => 'publish',
        'posts_per_page' => -1,
        'tax_query'      => [ [
            'taxonomy' => 'issue',
            'field'    => 'term_id',
            'terms'    => $issue_id,
        ] ],
        'orderby'        => 'menu_order date',
        'order'          => 'ASC',
        'fields'         => 'ids',
    ] );

    if ( empty( $posts_in_issue ) ) {
        return $result;
    }

    $current_index = array_search( $post_id, $posts_in_issue, true );
    if ( $current_index === false ) {
        return $result;
    }

    if ( $current_index > 0 ) {
        $prev_id        = $posts_in_issue[ $current_index - 1 ];
        $result['prev'] = [
            'url'       => get_permalink( $prev_id ),
            'title'     => get_the_title( $prev_id ),
            'thumbnail' => get_the_post_thumbnail_url( $prev_id, 'medium' ) ?: '',
        ];
    }

    if ( $current_index < count( $posts_in_issue ) - 1 ) {
        $next_id        = $posts_in_issue[ $current_index + 1 ];
        $result['next'] = [
            'url'       => get_permalink( $next_id ),
            'title'     => get_the_title( $next_id ),
            'thumbnail' => get_the_post_thumbnail_url( $next_id, 'medium' ) ?: '',
        ];
    }

    return $result;
}

/* -----------------------------------------------------------------------
 * 4. OUTPUT ghost-panel overlay into the footer.
 *
 *    IMPORTANT: We deliberately do NOT wrap the body content using
 *    wp_body_open hooks because Elementor Pro may handle that hook
 *    differently across template modes (Canvas, Full-Width, Default).
 *    The JavaScript (swipe.js) wraps the body content safely after the
 *    DOM has fully loaded, which works with every Elementor template.
 * --------------------------------------------------------------------- */
add_action( 'wp_footer', 'madmusings_swipe_output_overlay', 1 );
function madmusings_swipe_output_overlay() {
    if ( ! is_singular( 'post' ) ) {
        return;
    }

    $neighbours = madmusings_get_issue_neighbours( get_the_ID() );
    if ( empty( $neighbours['prev'] ) && empty( $neighbours['next'] ) ) {
        return;
    }

    $prev = $neighbours['prev'];
    $next = $neighbours['next'];
    ?>
    <!-- MadMusings Article Swipe — ghost panels -->
    <div id="mm-overlay-layer" aria-hidden="true">

        <?php if ( $prev ) : ?>
        <div id="mm-panel-prev"
             class="mm-panel mm-panel--prev"
             data-url="<?php echo esc_url( $prev['url'] ); ?>">
            <?php if ( $prev['thumbnail'] ) : ?>
            <img src="<?php echo esc_url( $prev['thumbnail'] ); ?>"
                 alt="<?php echo esc_attr( $prev['title'] ); ?>"
                 class="mm-panel__thumb"
                 loading="lazy">
            <?php endif; ?>
            <span class="mm-panel__title"><?php echo esc_html( $prev['title'] ); ?></span>
            <span class="mm-panel__arrow" aria-hidden="true">&#8592; Previous</span>
        </div>
        <?php endif; ?>

        <?php if ( $next ) : ?>
        <div id="mm-panel-next"
             class="mm-panel mm-panel--next"
             data-url="<?php echo esc_url( $next['url'] ); ?>">
            <?php if ( $next['thumbnail'] ) : ?>
            <img src="<?php echo esc_url( $next['thumbnail'] ); ?>"
                 alt="<?php echo esc_attr( $next['title'] ); ?>"
                 class="mm-panel__thumb"
                 loading="lazy">
            <?php endif; ?>
            <span class="mm-panel__title"><?php echo esc_html( $next['title'] ); ?></span>
            <span class="mm-panel__arrow" aria-hidden="true">Next &#8594;</span>
        </div>
        <?php endif; ?>

    </div><!-- /#mm-overlay-layer -->
    <?php
}
