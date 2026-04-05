/**
 * Screen Fingerprinting Constants
 *
 * Configuration values for screen detection and validation.
 */

/**
 * Minimum screen width to expect a taskbar/dock.
 *
 * Screens larger than 800px typically have OS chrome (taskbar, dock)
 * that reduces available screen space. A full-screen match on a large
 * display suggests headless mode or screen dimension spoofing.
 */
export const TASKBAR_DETECTION_THRESHOLD = 800;
