"""Pack every measured bubble trajectory of the March 2026 Winterthur campaign into the
compact binary that assets/js/lpt-tracks.js plays back on projects/field-lpt.html.

    python3 tools/build_lpt_tracks.py [trajectories.h5] [out.bin]

Defaults: "~/Documents/Bubble Project/Winterthur March 2026/vortex_fitting/trajectories.h5"
          -> assets/data/lpt-tracks.bin   (needs numpy + h5py; the .h5 is only read)

Input layout (written by vortex_fitting/build_trajectories_h5.py): flat point arrays
smooth/{x,y,z} [m], smooth/{vx,vy,vz} [m/s], points/frame, indexed per track by
trajectories/{start,length,file}; files/fps per recording (300-930 Hz, varies by run).
Frame: +x streamwise, +y lateral, z vertical, positions copied unchanged from the .mat.

What is kept: ALL tracks. Each track is decimated along its length to every k-th sample,
k = round(fps / TARGET_HZ), so every run is stored at ~40 Hz. Positions are quantized to
int16 at Q m around the volume centre; speed |v| (from the smoothed velocities) to uint8
at 0.05 m/s. No resampling, interpolation or extra smoothing.

Binary layout (little-endian):
    u32 header_len | header JSON (utf-8, space-padded to a multiple of 4)
    u16[2*n_tracks]   per track: first frame (counted from its run's first frame), n points;
                      point j is at t = (first + j*step)/fps   -- tracks grouped by run in
                      header order, sorted by first frame
    i16[3*n_points]   x,y,z interleaved: value = origin + q * Q
    u8 [n_points]     speed: value = s * 0.05 m/s
"""
import json, os, sys
import numpy as np
import h5py

SRC = os.path.expanduser('~/Documents/Bubble Project/Winterthur March 2026/vortex_fitting/trajectories.h5')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'data', 'lpt-tracks.bin')
TARGET_HZ = 40.0
Q = 0.0005          # m per position step
SPEED_Q = 0.05      # m/s per speed step


def main(src=SRC, out=OUT):
    with h5py.File(src, 'r') as f:
        fps = f['files/fps'][()]
        dsnum = f['files/fps'].attrs['dataset_number']
        tfile = f['trajectories/file'][()]
        start = f['trajectories/start'][()]
        length = f['trajectories/length'][()]
        frame = f['points/frame'][()]
        xyz = np.stack([f['smooth/' + k][()] for k in 'xyz'], 1)
        spd = np.sqrt(sum(f['smooth/' + k][()] ** 2 for k in ('vx', 'vy', 'vz')))

    lo, hi = np.percentile(xyz, 0.5, 0), np.percentile(xyz, 99.5, 0)
    origin = np.round((lo + hi) / 2, 2)
    runs, table, pts, sp = [], [], [], []
    for r in range(len(fps)):
        idx = np.where(tfile == r)[0]
        k = max(1, int(round(fps[r] / TARGET_HZ)))
        f0 = min(frame[start[i]] for i in idx)
        f1 = max(frame[start[i] + length[i] - 1] for i in idx)
        order = idx[np.argsort([frame[start[i]] for i in idx], kind='stable')]
        n_pts = 0
        for i in order:
            s = start[i] + np.arange(0, length[i], k)       # every k-th sample, from the first
            table.append((int(frame[start[i]] - f0), len(s)))
            pts.append(xyz[s]); sp.append(spd[s]); n_pts += len(s)
        runs.append(dict(dataset=int(dsnum[r]), fps=float(fps[r]), step=k, dt=k / float(fps[r]),
                         duration=round((f1 - f0) / float(fps[r]), 3), tracks=int(len(idx)), points=n_pts))
        print(f'run {dsnum[r]:>2}: {fps[r]:.0f} Hz, k={k:>2}, {len(idx):>5} tracks, {n_pts:>6} points, '
              f'{(f1 - f0) / fps[r]:.2f} s')

    P = np.concatenate(pts)
    q = np.round((P - origin) / Q)
    assert np.abs(q).max() < 32767, 'positions out of int16 range; raise Q'
    S = np.clip(np.round(np.concatenate(sp) / SPEED_Q), 0, 255).astype('<u1')
    T = np.array(table, dtype='<u2')
    assert T.max() < 65535

    header = dict(version=1, source=os.path.basename(os.path.dirname(src)) + '/' + os.path.basename(src),
                  campaign='OST Aventa, Winterthur, March 2026', frame='+x streamwise, +y lateral, z vertical [m]',
                  origin=origin.tolist(), q=Q, speed_q=SPEED_Q, target_hz=TARGET_HZ,
                  box=[np.floor(lo * 2) / 2, np.ceil(hi * 2) / 2], tracks=int(len(T)), points=int(len(P)),
                  runs=runs)
    header['box'] = [b.tolist() for b in header['box']]
    hb = json.dumps(header, separators=(',', ':')).encode()
    hb += b' ' * (-len(hb) % 4)
    with open(out, 'wb') as fo:
        fo.write(np.uint32(len(hb)).tobytes()); fo.write(hb)
        fo.write(T.tobytes()); fo.write(q.astype('<i2').tobytes()); fo.write(S.tobytes())
    print(f'{out}: {len(T)} tracks, {len(P)} points, {os.path.getsize(out) / 1e6:.2f} MB')


if __name__ == '__main__':
    main(*sys.argv[1:3])
