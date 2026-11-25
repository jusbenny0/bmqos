//! Draws the count onto the tray icon (Linux tray has no text next to the icon) – a red dot with a 3×5 px digit.
const GLYPHS: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111],
    [0b010, 0b110, 0b010, 0b010, 0b111],
    [0b111, 0b001, 0b111, 0b100, 0b111],
    [0b111, 0b001, 0b111, 0b001, 0b111],
    [0b101, 0b101, 0b111, 0b001, 0b001],
    [0b111, 0b100, 0b111, 0b001, 0b111],
    [0b111, 0b100, 0b111, 0b101, 0b111],
    [0b111, 0b001, 0b001, 0b001, 0b001],
    [0b111, 0b101, 0b111, 0b101, 0b111],
    [0b111, 0b101, 0b111, 0b001, 0b111],
];

/// `rgba` is a square `size`×`size` icon; when `count > 0` a badge is drawn in the bottom right (9+ for >9).
/// `hot` = needs attention: the badge gets a white ring and a darker red so it stands out in the tray.
pub fn draw(rgba: &mut [u8], size: usize, count: usize, hot: bool) {
    if count == 0 || rgba.len() != size * size * 4 {
        return;
    }
    let r = size as f32 * 0.32;
    let (cx, cy) = (size as f32 - r, size as f32 - r);
    for y in 0..size {
        for x in 0..size {
            let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
            let d2 = dx * dx + dy * dy;
            if d2 <= r * r {
                let i = (y * size + x) * 4;
                let ring = hot && d2 > (r - size as f32 * 0.06).powi(2);
                rgba[i..i + 4].copy_from_slice(if ring { &[0xff, 0xff, 0xff, 0xff] } else if hot { &[0xc4, 0x1e, 0x1e, 0xff] } else { &[0xe8, 0x55, 0x3d, 0xff] });
            }
        }
    }
    let scale = (size / 16).max(1);
    let digits: Vec<usize> = if count > 9 { vec![9] } else { vec![count] };
    let plus = count > 9;
    let w = (digits.len() * 3 + if plus { 4 } else { 0 }) * scale;
    let h = 5 * scale;
    let (x0, y0) = ((cx as usize).saturating_sub(w / 2), (cy as usize).saturating_sub(h / 2));
    let mut put = |gx: usize, gy: usize| {
        for sy in 0..scale {
            for sx in 0..scale {
                let (px, py) = (x0 + gx * scale + sx, y0 + gy * scale + sy);
                if px < size && py < size {
                    let i = (py * size + px) * 4;
                    rgba[i..i + 4].copy_from_slice(&[0xff, 0xff, 0xff, 0xff]);
                }
            }
        }
    };
    for (n, d) in digits.iter().enumerate() {
        for (gy, row) in GLYPHS[*d].iter().enumerate() {
            for gx in 0..3 {
                if row >> (2 - gx) & 1 == 1 {
                    put(n * 3 + gx, gy);
                }
            }
        }
    }
    if plus {
        let off = digits.len() * 3 + 1;
        for g in [(1, 1), (0, 2), (1, 2), (2, 2), (1, 3)] {
            put(off + g.0, g.1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_leaves_icon_untouched() {
        let mut v = vec![7u8; 32 * 32 * 4];
        draw(&mut v, 32, 0, false);
        assert!(v.iter().all(|b| *b == 7));
    }

    #[test]
    fn draws_red_dot_and_white_digit() {
        let mut v = vec![0u8; 32 * 32 * 4];
        draw(&mut v, 32, 3, false);
        let px = |x: usize, y: usize| &v[(y * 32 + x) * 4..(y * 32 + x) * 4 + 4];
        assert_eq!(px(31, 31)[3], 0); // the corner outside the circle stayed transparent
        assert!(v.chunks(4).any(|p| p == [0xe8, 0x55, 0x3d, 0xff]));
        assert!(v.chunks(4).any(|p| p == [0xff, 0xff, 0xff, 0xff]));
        draw(&mut v, 32, 12, true); // must not panic
    }
}
