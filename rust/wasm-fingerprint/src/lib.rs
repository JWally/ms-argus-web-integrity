use wasm_bindgen::prelude::*;

// Import JS function for boundary timing test
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = "boundaryCallback")]
    fn boundary_callback();
}

// =============================================================================
// CORE TIMING PROBES
// =============================================================================

/// Integer ALU stress test - measures raw integer crunching speed.
#[wasm_bindgen]
pub fn cpu_stress_test(iterations: u32) -> u32 {
    let mut x: u32 = 0;
    for i in 0..iterations {
        x = x.wrapping_add(i);
        x = x.wrapping_mul(3);
        x = x ^ (x >> 2);
    }
    x
}

/// RAM bandwidth test - measures memory throughput with data dependencies
/// to prevent JIT optimization.
#[wasm_bindgen]
pub fn ram_stress_test(iterations: u32) -> u32 {
    let size = 16_000_000; // 64MB
    let mut buffer = vec![0u32; size];
    let mut junk: u32 = 0xDEADBEEF;

    for _ in 0..iterations {
        for i in (0..size).step_by(32) {
            let read_val = buffer[i];
            junk = junk.wrapping_add(read_val).wrapping_mul(1664525);
            buffer[i] = read_val.wrapping_add(junk);
        }
    }
    junk
}

/// Branch prediction chaos test - random branches that defeat prediction.
#[wasm_bindgen]
pub fn branch_stress_test(iterations: u32) -> u32 {
    let mut sum: u32 = 0;
    let mut rng: u32 = 12345;

    for _ in 0..iterations {
        rng = rng.wrapping_mul(1664525).wrapping_add(1013904223);
        if (rng & 0x80000000) != 0 {
            sum = sum.wrapping_add(1);
        } else {
            sum = sum.wrapping_add(2);
        }
        if (rng & 0x100) != 0 {
            sum = sum ^ 0xF0F0F0F0;
        }
    }
    sum
}

/// Floating point stress test - chained FP operations.
#[wasm_bindgen]
pub fn float_stress_test(iterations: u32) -> f64 {
    let mut x: f64 = 1.5;
    let mut y: f64 = 0.5;

    for i in 0..iterations {
        x = x / 1.0000001;
        y = y * 1.0000001;
        x = x + y;
        if i % 100 == 0 {
            x = x + 1.0;
        }
    }
    x
}

/// JIT warmup test - call repeatedly to measure optimization tiers.
#[wasm_bindgen]
pub fn jit_warmup_test(iterations: u32) -> u32 {
    let mut x: u32 = 1;
    for _ in 0..iterations {
        x = x.wrapping_mul(1664525).wrapping_add(1013904223);
        x = x.rotate_left(7);
    }
    x
}

// =============================================================================
// MEMORY PROBES
// =============================================================================

/// Memory pressure test - attempts to allocate `mb` megabytes.
/// Returns true if allocation succeeds, false otherwise.
#[wasm_bindgen]
pub fn memory_pressure_test(mb: u32) -> bool {
    let bytes = (mb * 1024 * 1024) as usize;
    let mut vec: Vec<u32> = Vec::with_capacity(bytes / 4);
    vec.push(1);
    vec.capacity() > 0
}

/// Memory grow test - allocates specified MB and touches every page.
/// Used to measure allocation timing at different memory pressures.
#[wasm_bindgen]
pub fn memory_grow_test(mb: u32) -> u32 {
    let bytes = (mb as usize) * 1024 * 1024;
    let pages = bytes / 4096;

    // Allocate the memory
    let mut vec: Vec<u8> = Vec::with_capacity(bytes);

    // Touch every page to force actual allocation (not just virtual)
    for i in 0..pages {
        vec.push((i & 0xFF) as u8);
        // Skip to next page boundary
        for _ in 0..(4096 - 1) {
            vec.push(0);
        }
    }

    vec.len() as u32
}

// =============================================================================
// WASM-SPECIFIC PROBES
// =============================================================================

/// Boundary overhead test - calls imported JS function N times.
/// JS side measures total time, revealing WASM<->JS call overhead.
#[wasm_bindgen]
pub fn boundary_test(iterations: u32) -> u32 {
    for _ in 0..iterations {
        boundary_callback();
    }
    iterations
}

/// 64-bit integer benchmark - tests i64 performance which varies by engine.
#[wasm_bindgen]
pub fn i64_benchmark(iterations: u32) -> u64 {
    let mut x: u64 = 0xDEADBEEFCAFEBABE;
    for i in 0..iterations {
        x = x.wrapping_add(i as u64);
        x = x.wrapping_mul(6364136223846793005);
        x = x ^ (x >> 33);
    }
    x
}

// =============================================================================
// SIMD PROBES (only compiled with simd feature)
// =============================================================================

#[cfg(feature = "simd")]
mod simd;

#[cfg(feature = "simd")]
pub use simd::*;
