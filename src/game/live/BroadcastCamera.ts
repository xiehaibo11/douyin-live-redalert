type Point = { x: number; y: number };

export function armyFocus(left: Point[], right: Point[], fallback: Point): Point {
    const points = [...left, ...right];
    if (!points.length) return fallback;
    return {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
}
