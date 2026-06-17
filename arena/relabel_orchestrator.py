#!/usr/bin/env python3
"""Robust parallel Stockfish relabeling orchestrator.

Manages concurrency, tracks progress, auto-restarts crashed/stuck workers,
and displays a real-time CLI status dashboard.
"""
import argparse
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta

# Constants & default paths
HERE = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.join(HERE, 'sf-relabel-worker.py')
TOOLS = 'F:\\tools'
LOGS = os.path.join(TOOLS, 'relabel-logs')
DEFAULT_STOCKFISH_REVIEW_DEPTH = 24


def get_file_line_count(path):
    if not os.path.exists(path):
        return 0
    count = 0
    try:
        with open(path, 'rb') as f:
            for _ in f:
                count += 1
    except Exception:
        pass
    return count


def get_file_size(path):
    if not os.path.exists(path):
        return 0
    try:
        return os.path.getsize(path)
    except Exception:
        return 0


def kill_worker(worker_info):
    """Safely kills the python worker and all its child processes (Stockfish) using taskkill."""
    proc = worker_info['proc']
    if proc.poll() is None:
        try:
            # Kill process tree recursively using built-in Windows taskkill
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], 
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass
    
    # Close file handles
    try:
        worker_info['out_file'].close()
        worker_info['err_file'].close()
    except Exception:
        pass


def format_time(seconds):
    if seconds is None or seconds < 0:
        return "N/A"
    return str(timedelta(seconds=int(seconds)))


def main():
    parser = argparse.ArgumentParser(description="Robust Stockfish Relabeling Orchestrator")
    parser.add_argument("-w", "--workers", type=int, default=8, help="Max concurrent workers (default: 8)")
    parser.add_argument("-d", "--depth", type=int, default=DEFAULT_STOCKFISH_REVIEW_DEPTH, help=f"Stockfish search depth (default: {DEFAULT_STOCKFISH_REVIEW_DEPTH})")
    parser.add_argument("-m", "--hash", type=int, default=256, help="Stockfish Hash size in MB (default: 256)")
    parser.add_argument("-t", "--timeout", type=int, default=600, help="Stuck timeout in seconds (default: 600)")
    parser.add_argument("-s", "--shards", type=int, default=12, help="Total number of shards (default: 12)")
    args = parser.parse_args()

    os.makedirs(LOGS, exist_ok=True)

    print("=" * 60)
    print("        STOCKFISH RELABELING ORCHESTRATOR INITIALIZATION")
    print("=" * 60)
    print(f"Max Concurrent Workers: {args.workers}")
    print(f"Search Depth          : {args.depth}")
    print(f"Hash Size per Worker  : {args.hash} MB")
    print(f"Stuck Timeout         : {args.timeout}s (10 min)")
    print(f"Total Shards          : {args.shards}")
    print(f"Worker Script         : {WORKER}")
    print(f"Tools Directory       : {TOOLS}")
    print("Scanning shard sizes and status...")

    # Shard data tracking
    # Shard ID -> dict
    shards = {}
    for i in range(args.shards):
        shard_str = f"{i:02d}"
        in_path = os.path.join(TOOLS, f"ourq-{shard_str}.jsonl")
        out_path = os.path.join(TOOLS, f"ourq-d24-{shard_str}.jsonl")
        
        if not os.path.exists(in_path):
            print(f"  Warning: Shard {shard_str} input file does not exist at {in_path}. Skipping.")
            continue
            
        total_lines = get_file_line_count(in_path)
        done_lines = get_file_line_count(out_path)
        
        status = "Finished" if done_lines >= total_lines and total_lines > 0 else "Pending"
        
        shards[i] = {
            'in_path': in_path,
            'out_path': out_path,
            'total': total_lines,
            'done': done_lines,
            'status': status,  # "Pending", "Running", "Finished", "Stuck", "Blocked" (failed repeatedly)
            'failures': 0,      # consecutive restarts without making progress
            'last_progress_count': done_lines
        }
        print(f"  Shard {shard_str}: {done_lines}/{total_lines} ({done_lines*100//total_lines if total_lines > 0 else 0}%) - {status}")

    active_workers = {}  # shard_idx -> worker_dict
    
    t_start = time.time()
    t_last_dashboard = 0
    positions_at_start = sum(s['done'] for s in shards.values())
    total_positions = sum(s['total'] for s in shards.values())
    
    print("\nStarting orchestrator loop. Press Ctrl+C to terminate cleanly.")
    time.sleep(2)

    try:
        while True:
            t_now = time.time()
            
            # 1. Update status of active workers
            exited_shards = []
            for shard_idx, w_info in active_workers.items():
                proc = w_info['proc']
                poll = proc.poll()
                out_path = w_info['out_path']
                
                # Check for progress by reading file size
                curr_size = get_file_size(out_path)
                if curr_size != w_info['last_size']:
                    w_info['last_size'] = curr_size
                    w_info['last_change_time'] = t_now
                    shards[shard_idx]['status'] = "Running"
                
                # Check if stuck
                time_since_change = t_now - w_info['last_change_time']
                if poll is None and time_since_change > args.timeout:
                    print(f"\n[{shard_idx:02d}] WARNING: No progress for {int(time_since_change)}s. Stuck? Restarting...", flush=True)
                    shards[shard_idx]['status'] = "Stuck"
                    kill_worker(w_info)
                    exited_shards.append(shard_idx)
                    continue
                
                # Check if exited
                if poll is not None:
                    # Close handles
                    try:
                        w_info['out_file'].close()
                        w_info['err_file'].close()
                    except Exception:
                        pass
                    
                    # Update done count
                    done_now = get_file_line_count(out_path)
                    shards[shard_idx]['done'] = done_now
                    
                    # Determine exit status
                    if poll == 0 and done_now >= shards[shard_idx]['total']:
                        shards[shard_idx]['status'] = "Finished"
                        shards[shard_idx]['failures'] = 0
                        print(f"\n[{shard_idx:02d}] Finished successfully!", flush=True)
                    else:
                        # Crash or premature exit
                        print(f"\n[{shard_idx:02d}] Process exited with code {poll} prematurely ({done_now}/{shards[shard_idx]['total']}).", flush=True)
                        exited_shards.append(shard_idx)
            
            # Clean up exited workers from the active map
            for shard_idx in exited_shards:
                if shard_idx in active_workers:
                    del active_workers[shard_idx]
                    
                    # Check progress since last launch to detect consecutive failures
                    done_now = shards[shard_idx]['done']
                    if done_now > shards[shard_idx]['last_progress_count']:
                        shards[shard_idx]['failures'] = 0
                        shards[shard_idx]['last_progress_count'] = done_now
                        shards[shard_idx]['status'] = "Pending"
                    else:
                        shards[shard_idx]['failures'] += 1
                        print(f"[{shard_idx:02d}] Failed {shards[shard_idx]['failures']} time(s) consecutively without making progress.", flush=True)
                        if shards[shard_idx]['failures'] >= 5:
                            shards[shard_idx]['status'] = "Blocked"
                            print(f"[{shard_idx:02d}] ERROR: Shard blocked after 5 consecutive failures. Manual intervention required.", flush=True)
                        else:
                            shards[shard_idx]['status'] = "Pending"

            # 2. Spawn new workers if capacity allows
            while len(active_workers) < args.workers:
                # Find a pending shard to spawn
                next_shard = None
                for idx, info in shards.items():
                    if info['status'] == "Pending":
                        next_shard = idx
                        break
                        
                if next_shard is None:
                    break  # No more pending shards
                    
                # Spawn worker
                shard_str = f"{next_shard:02d}"
                so = os.path.join(LOGS, f"shard-{shard_str}.out")
                se = os.path.join(LOGS, f"shard-{shard_str}.err")
                
                out_file = open(so, "a", encoding="utf8")
                err_file = open(se, "a", encoding="utf8")
                
                cmd = [sys.executable, WORKER, shards[next_shard]['in_path'], shards[next_shard]['out_path'], str(args.depth), str(args.hash)]
                proc = subprocess.Popen(cmd, stdout=out_file, stderr=err_file, text=True)
                
                active_workers[next_shard] = {
                    'proc': proc,
                    'out_file': out_file,
                    'err_file': err_file,
                    'out_path': shards[next_shard]['out_path'],
                    'last_size': get_file_size(shards[next_shard]['out_path']),
                    'last_change_time': t_now
                }
                
                shards[next_shard]['status'] = "Running"
                shards[next_shard]['last_progress_count'] = shards[next_shard]['done']
                print(f"[{shard_str}] Launched worker PID {proc.pid} (resuming from {shards[next_shard]['done']}/{shards[next_shard]['total']})", flush=True)

            # 3. Periodically print CLI dashboard
            if t_now - t_last_dashboard >= 10:
                t_last_dashboard = t_now
                
                # Recalculate progress for all active shards
                for idx, w_info in active_workers.items():
                    shards[idx]['done'] = get_file_line_count(w_info['out_path'])
                
                total_done = sum(s['done'] for s in shards.values())
                progress_made = total_done - positions_at_start
                elapsed = t_now - t_start
                rate = progress_made / elapsed if elapsed > 0 else 0
                remaining = total_positions - total_done
                eta = remaining / rate if rate > 0 else None
                
                # Print dashboard
                os.system('cls' if os.name == 'nt' else 'clear')
                print("=" * 70)
                print(f"Stockfish d{args.depth} Relabeling Dashboard - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
                print("=" * 70)
                print(f"Total Progress : {total_done:,} / {total_positions:,} positions ({total_done * 100 // total_positions if total_positions > 0 else 0}%)")
                print(f"Session Progress: {progress_made:,} positions in {format_time(elapsed)}")
                print(f"Throughput     : {rate:.2f} pos/sec (avg across {len(active_workers)} active workers)")
                print(f"Remaining      : {remaining:,} positions")
                print(f"Estimated ETA  : {format_time(eta)}")
                print("-" * 70)
                print(f"{'Shard':<6} | {'Status':<10} | {'Progress':<18} | {'%':<5} | {'PID':<6} | {'Stuck For':<10}")
                print("-" * 70)
                for idx in sorted(shards.keys()):
                    info = shards[idx]
                    status = info['status']
                    done = info['done']
                    total = info['total']
                    pct = f"{done * 100 // total if total > 0 else 0}%"
                    pid = str(active_workers[idx]['proc'].pid) if idx in active_workers else "-"
                    
                    stuck_str = "-"
                    if idx in active_workers:
                        stuck_seconds = t_now - active_workers[idx]['last_change_time']
                        if stuck_seconds > 10:
                            stuck_str = f"{int(stuck_seconds)}s"
                            
                    print(f"shard{idx:02d} | {status:<10} | {done:7,} / {total:7,} | {pct:<5} | {pid:<6} | {stuck_str:<10}")
                print("=" * 70)
                sys.stdout.flush()

            # 4. Check if all shards are finished/blocked
            all_done = all(info['status'] in ["Finished", "Blocked"] for info in shards.values())
            if all_done:
                print("\nAll shards finished or blocked! Orchestrator exiting.")
                break

            time.sleep(1)

    except KeyboardInterrupt:
        print("\n\nOrchestrator interrupted by user (Ctrl+C). Initiating clean shutdown...")
    finally:
        # Guarantee cleanup of all child processes
        print(f"Stopping {len(active_workers)} running workers...")
        for shard_idx, w_info in list(active_workers.items()):
            print(f"  Killing shard {shard_idx:02d} (PID {w_info['proc'].pid})...")
            kill_worker(w_info)
        print("Clean shutdown complete.")


if __name__ == '__main__':
    main()
