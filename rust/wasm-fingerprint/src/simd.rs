use wasm_bindgen::prelude::*;
use std::arch::wasm32::*;

/// SIMD benchmark - performs vectorized operations.
/// Compare timing against cpu_stress_test to get SIMD ratio.
#[wasm_bindgen]
pub fn simd_benchmark(iterations: u32) -> u32 {
    // Initialize 4x u32 SIMD vector
    let mut v = u32x4(0, 1, 2, 3);
    let multiplier = u32x4(3, 3, 3, 3);
    let adder = u32x4(1, 1, 1, 1);

    for _ in 0..iterations {
        // Parallel operations on 4 lanes
        v = u32x4_add(v, adder);
        v = u32x4_mul(v, multiplier);
        v = v128_xor(v, u32x4_shr(v, 2));
    }

    // Extract and combine lanes for result
    u32x4_extract_lane::<0>(v)
        .wrapping_add(u32x4_extract_lane::<1>(v))
        .wrapping_add(u32x4_extract_lane::<2>(v))
        .wrapping_add(u32x4_extract_lane::<3>(v))
}

/// SIMD float benchmark - vectorized floating point operations.
#[wasm_bindgen]
pub fn simd_float_benchmark(iterations: u32) -> f32 {
    let mut v = f32x4(1.5, 2.5, 3.5, 4.5);
    let divisor = f32x4(1.0000001, 1.0000001, 1.0000001, 1.0000001);
    let multiplier = f32x4(1.0000001, 1.0000001, 1.0000001, 1.0000001);

    for i in 0..iterations {
        v = f32x4_div(v, divisor);
        v = f32x4_mul(v, multiplier);
        v = f32x4_add(v, v);

        // Periodic reset to prevent Infinity/NaN
        if i % 100 == 0 {
            v = f32x4_add(v, f32x4(1.0, 1.0, 1.0, 1.0));
        }
    }

    f32x4_extract_lane::<0>(v)
}
