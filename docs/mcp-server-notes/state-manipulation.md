# State Manipulation Functions

This document lists all state manipulation and retrieval functions available in the Hello3DLLM application. These functions are exposed via MCP tools and can be used by Claude/ChatGPT to control the 3D scene.

## State Representation

All state values use **numeric representations** (not direction names) for precision and reproducibility:
- **Light positions**: Azimuth (0-360°), Elevation (0-90°), Distance (units)
- **Model rotation**: Euler angles in degrees (X, Y, Z)
- **Camera**: Distance (units), Field of View (FOV value)
- **Colors**: Hex codes or standardized color names (Apple crayon colors)
- **Intensities**: Numeric values (0.0+)

## Two Modes of Manipulation

### Absolute Mode
- Sets exact values regardless of current state
- Can use numeric values or direction names (for azimuth)
- Examples: `set_key_light_position_spherical({ azimuth: 56.25 })` or `set_key_light_position_spherical({ azimuth: "northeast" })`

### Relative/Adjustment Mode (Nudges)
- Requires retrieving state first
- Works relative to current numeric state
- Uses terms like "clockwise", "counterclockwise", "nudge", "move toward"
- Examples: `rotate_key_light_clockwise({ degrees: 10 })` or `move_key_light_toward_direction({ direction: "northeast", degrees: 10 })`

---

## State Manipulation Functions

### Model State Manipulation

#### Absolute Positioning
- **`set_model_rotation`** - Set model rotation using Euler angles in degrees
  - Parameters: `{ x: number, y: number, z: number }`
  - X = pitch, Y = yaw, Z = roll

#### Relative Adjustments
- **`rotate_model_clockwise`** - Rotate model clockwise around Y axis (yaw)
  - Parameters: `{ degrees?: number }` (defaults to 10°)
- **`rotate_model_counterclockwise`** - Rotate model counterclockwise around Y axis (yaw)
  - Parameters: `{ degrees?: number }` (defaults to 10°)
- **`nudge_model_pitch_up`** - Increase model pitch (X axis rotation)
  - Parameters: `{ degrees?: number }` (defaults to 5°)
- **`nudge_model_pitch_down`** - Decrease model pitch (X axis rotation)
  - Parameters: `{ degrees?: number }` (defaults to 5°)
- **`nudge_model_roll`** - Adjust model roll (Z axis rotation)
  - Parameters: `{ degrees?: number }` (defaults to 5°, positive = clockwise)

#### Model Properties
- **`change_model_color`** - Set model color
  - Parameters: `{ color: string }` (hex code or Apple crayon color name)
- **`change_model_size`** - Set uniform model scale
  - Parameters: `{ size: number }` (positive number)
- **`scale_model`** - Scale model independently in each dimension
  - Parameters: `{ x: number, y: number, z: number }` (positive numbers)

---

### Key Light State Manipulation

#### Absolute Positioning (Spherical Coordinates)
- **`set_key_light_position_spherical`** - Set key light position using camera-centric spherical coordinates
  - Parameters: `{ azimuth: number|string, elevation: number }`
  - Azimuth: 0-360° or direction name (e.g., "northeast", "NW")
  - Elevation: 0-90° (0° = horizon, 90° = overhead)
  - Preserves current distance
- **`set_key_light_distance`** - Set key light distance from model origin
  - Parameters: `{ distance: number }` (positive number, units from origin)
  - Preserves current azimuth and elevation

#### Relative Adjustments
- **`rotate_key_light_clockwise`** - Rotate key light clockwise (decreases azimuth)
  - Parameters: `{ degrees?: number }` (defaults to 10°)
- **`rotate_key_light_counterclockwise`** - Rotate key light counterclockwise (increases azimuth)
  - Parameters: `{ degrees?: number }` (defaults to 10°)
- **`nudge_key_light_elevation_up`** - Increase key light elevation
  - Parameters: `{ degrees?: number }` (defaults to 5°)
- **`nudge_key_light_elevation_down`** - Decrease key light elevation
  - Parameters: `{ degrees?: number }` (defaults to 5°)
- **`move_key_light_toward_direction`** - Move key light toward a specific direction
  - Parameters: `{ direction: number|string, degrees?: number }`
  - Direction: azimuth angle (0-360°) or direction name
  - Degrees: amount to move toward target (defaults to 10°)

#### Legacy Swing/Walk Functions (Relative Adjustments)
- **`swing_key_light_up`** - Rotate key light upward (no parameters)
- **`swing_key_light_down`** - Rotate key light downward (no parameters)
- **`swing_key_light_left`** - Rotate key light leftward (no parameters)
- **`swing_key_light_right`** - Rotate key light rightward (no parameters)
- **`walk_key_light_in`** - Move key light closer to model origin (no parameters)
- **`walk_key_light_out`** - Move key light farther from model origin (no parameters)

#### Key Light Properties
- **`set_key_light_intensity`** - Set key light intensity
  - Parameters: `{ intensity: number }` (0.0 or higher)
- **`set_key_light_color`** - Set key light color
  - Parameters: `{ color: string }` (hex code or Apple crayon color name)

---

### Fill Light State Manipulation

#### Absolute Positioning (Spherical Coordinates)
- **`set_fill_light_position_spherical`** - Set fill light position using camera-centric spherical coordinates
  - Parameters: `{ azimuth: number|string, elevation: number }`
  - Azimuth: 0-360° or direction name (e.g., "northeast", "NW")
  - Elevation: 0-90° (0° = horizon, 90° = overhead)
  - Preserves current distance
- **`set_fill_light_distance`** - Set fill light distance from model origin
  - Parameters: `{ distance: number }` (positive number, units from origin)
  - Preserves current azimuth and elevation

#### Relative Adjustments
- **`rotate_fill_light_clockwise`** - Rotate fill light clockwise (decreases azimuth)
  - Parameters: `{ degrees?: number }` (defaults to 10°)
- **`rotate_fill_light_counterclockwise`** - Rotate fill light counterclockwise (increases azimuth)
  - Parameters: `{ degrees?: number }` (defaults to 10°)
- **`nudge_fill_light_elevation_up`** - Increase fill light elevation
  - Parameters: `{ degrees?: number }` (defaults to 5°)
- **`nudge_fill_light_elevation_down`** - Decrease fill light elevation
  - Parameters: `{ degrees?: number }` (defaults to 5°)
- **`move_fill_light_toward_direction`** - Move fill light toward a specific direction
  - Parameters: `{ direction: number|string, degrees?: number }`
  - Direction: azimuth angle (0-360°) or direction name
  - Degrees: amount to move toward target (defaults to 10°)

#### Legacy Swing/Walk Functions (Relative Adjustments)
- **`swing_fill_light_up`** - Rotate fill light upward (no parameters)
- **`swing_fill_light_down`** - Rotate fill light downward (no parameters)
- **`swing_fill_light_left`** - Rotate fill light leftward (no parameters)
- **`swing_fill_light_right`** - Rotate fill light rightward (no parameters)
- **`walk_fill_light_in`** - Move fill light closer to model origin (no parameters)
- **`walk_fill_light_out`** - Move fill light farther from model origin (no parameters)

#### Fill Light Properties
- **`set_fill_light_intensity`** - Set fill light intensity
  - Parameters: `{ intensity: number }` (0.0 or higher)
- **`set_fill_light_color`** - Set fill light color
  - Parameters: `{ color: string }` (hex code or Apple crayon color name)

---

### Camera State Manipulation

#### Absolute Positioning
- **`dolly_camera`** - Set camera distance from origin
  - Parameters: `{ distance: number }` (positive number, units from origin)

#### Relative Adjustments
- **`dolly_camera_in`** - Move camera closer to origin
  - Parameters: `{ amount?: number }` (optional, defaults to configured dolly speed)
- **`dolly_camera_out`** - Move camera farther from origin
  - Parameters: `{ amount?: number }` (optional, defaults to configured dolly speed)

#### Field of View (FOV) Control
- **`set_camera_fov`** - Set camera field of view (absolute)
  - Parameters: `{ fov: number }` (typically 0.5-5.0, lower = wider angle)
- **`increase_camera_fov`** - Increase field of view (wider angle)
  - Parameters: `{ amount?: number }` (optional, defaults to configured FOV speed)
- **`decrease_camera_fov`** - Decrease field of view (narrower angle, more zoomed in)
  - Parameters: `{ amount?: number }` (optional, defaults to configured FOV speed)

---

### Scene State Manipulation

- **`change_background_color`** - Set scene background color
  - Parameters: `{ color: string }` (hex code or Apple crayon color name)

---

## State Retrieval Functions

These functions are used by Claude/ChatGPT to query the current state of the scene. **Note**: Bidirectional communication is **fully implemented**. These functions return actual state data to Claude/ChatGPT, enabling conditional logic, incremental changes, and state verification.

### Model State Retrieval

- **`get_model_rotation`** - Get current model rotation as Euler angles
  - Returns: `{ x: number, y: number, z: number }` (degrees, XYZ order)
  - X = pitch, Y = yaw, Z = roll
- **`get_model_color`** - Get current model color
  - Returns: `string` (hex color code, e.g., "#ff0000")
- **`get_model_scale`** - Get current model scale in each dimension
  - Returns: `{ x: number, y: number, z: number }` (scale factors, positive numbers)

### Key Light State Retrieval

- **`get_key_light_position_spherical`** - Get current key light position in spherical coordinates
  - Returns: `{ azimuth: number, elevation: number, distance: number }`
  - Azimuth: 0-360° (numeric only, no direction names)
  - Elevation: 0-90°
  - Distance: units from model origin
- **`get_key_light_intensity`** - Get current key light intensity
  - Returns: `number` (intensity value, 0.0 or higher)
- **`get_key_light_color`** - Get current key light color
  - Returns: `string` (hex color code, e.g., "#ffffff")
- **`get_key_light_size`** - Get current key light area size
  - Returns: `{ width: number, height: number }` (positive numbers, units)

### Fill Light State Retrieval

- **`get_fill_light_position_spherical`** - Get current fill light position in spherical coordinates
  - Returns: `{ azimuth: number, elevation: number, distance: number }`
  - Azimuth: 0-360° (numeric only, no direction names)
  - Elevation: 0-90°
  - Distance: units from model origin
- **`get_fill_light_intensity`** - Get current fill light intensity
  - Returns: `number` (intensity value, 0.0 or higher)
- **`get_fill_light_color`** - Get current fill light color
  - Returns: `string` (hex color code, e.g., "#ffffff")
- **`get_fill_light_size`** - Get current fill light area size
  - Returns: `{ width: number, height: number }` (positive numbers, units)

### Camera State Retrieval

- **`get_camera_distance`** - Get current camera distance from origin
  - Returns: `number` (positive number, units from origin)
- **`get_camera_fov`** - Get current camera field of view
  - Returns: `number` (FOV value, typically 0.5-5.0, lower = wider angle)

### Scene State Retrieval

- **`get_background_color`** - Get current scene background color
  - Returns: `string` (hex color code, e.g., "#000000")

---

## Usage Patterns

### Pattern 1: Absolute Positioning
```
User: "Position key light at northeast, 45° elevation"
Claude: Calls set_key_light_position_spherical({ azimuth: "northeast", elevation: 45 })
```

### Pattern 2: Relative Adjustment (Requires State Retrieval)
```
User: "Rotate the key light clockwise 10 degrees"
Claude: 
  1. Calls get_key_light_position_spherical() → { azimuth: 47, elevation: 45, distance: 8.5 }
  2. Calls rotate_key_light_clockwise({ degrees: 10 })
  3. Result: Light moves from 47° to 37° azimuth
```

### Pattern 3: Comparative Operations (Requires State Retrieval)
```
User: "Make key light brighter than fill light"
Claude:
  1. Calls get_key_light_intensity() → 2.5
  2. Calls get_fill_light_intensity() → 0.2
  3. Compares: 2.5 > 0.2, so increases key light further
  4. Calls set_key_light_intensity({ intensity: 3.0 })
```

---

## Direction Names

The following direction names are supported for azimuth values (in absolute positioning):
- **Cardinal**: `north` (0°), `east` (90°), `south` (180°), `west` (270°)
- **Intercardinal**: `northeast` (45°), `northwest` (315°), `southeast` (135°), `southwest` (225°)
- **Additional**: `nne` (22.5°), `ene` (67.5°), `ese` (112.5°), `sse` (157.5°), `ssw` (202.5°), `wsw` (247.5°), `wnw` (292.5°), `nnw` (337.5°)
- **Abbreviations**: `n`, `e`, `s`, `w`, `ne`, `nw`, `se`, `sw`

**Note**: Direction names are only used for **input** (absolute positioning). State retrieval always returns **numeric values** (e.g., `azimuth: 315` not `azimuth: "northwest"`).

---

## Coordinate System Reference

### Camera-Centric Spherical Coordinates
- **Azimuth (0-360°)**: Horizontal angle from camera's perspective
  - 0° = Camera forward (North, toward model)
  - 90° = Camera right (East)
  - 180° = Behind camera (South)
  - 270° = Camera left (West)
- **Elevation (0-90°)**: Vertical angle above horizon
  - 0° = Horizon
  - 90° = Directly overhead
- **Distance**: Radial distance from model origin

### Model Rotation (Euler Angles)
- **X (Pitch)**: Rotation around X axis (tilt up/down)
- **Y (Yaw)**: Rotation around Y axis (rotate left/right)
- **Z (Roll)**: Rotation around Z axis (tilt side to side)
- **Order**: XYZ (Three.js default)
- **Units**: Degrees (0-360°)

---

## Implementation Notes

### State Manipulation Flow
1. MCP tool called by Claude/ChatGPT
2. Server routes command to browser via WebSocket
3. Browser command handler processes command
4. SceneManager/AreaLight/RotationController methods execute
5. State is updated internally (Three.js objects)
6. Scene renders with new state

### State Retrieval Flow (Fully Implemented)
1. MCP tool called by Claude/ChatGPT (e.g., `get_model_color`)
2. Server routes query to browser via WebSocket with unique `requestId`
3. Browser command handler retrieves state from SceneManager
4. Browser sends state response back to server via WebSocket with matching `requestId`
5. Server resolves Promise and returns state to Claude/ChatGPT
6. State is cached on server for fast subsequent queries (unless `forceRefresh: true`)

### Relative Adjustment Implementation
Relative adjustment functions:
1. Retrieve current numeric state
2. Calculate new value based on adjustment
3. Apply new value using absolute positioning function
4. All calculations use numeric values (not direction names)

---

## Current Implementation Status

- ✅ **Bidirectional State Queries**: Fully implemented - Browser → Server responses for state retrieval
- ✅ **State Caching**: Server-side cache of current state for faster queries (hybrid approach with `forceRefresh` option)
- ✅ **State Metadata**: All state queries include timestamps, source indicators (cache vs. fresh), and staleness warnings
- ✅ **Automatic State Updates**: Browser automatically pushes state updates after each command

## Future Enhancements

- **State Comparison Tools**: Functions to compare two states
- **State Snapshots**: Save/restore complete scene state
- **State Validation**: Verify state consistency and bounds

