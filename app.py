from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
import psycopg as psycopg2
from psycopg.rows import dict_row
import random
import json
from datetime import datetime

app = Flask(__name__)
CORS(app)

# Database configuration
DB_CONFIG = {
    'host': 'localhost',
    'database': 'railway_control',
    'user': 'postgres',
    'password': 'warewarewauchyuujindearu',  # CHANGE THIS to your PostgreSQL password
    'port': 5432
}

def get_db_connection():
    """Create and return a database connection"""
    conn = psycopg2.connect(
        host=DB_CONFIG['host'],
        dbname=DB_CONFIG['database'],
        user=DB_CONFIG['user'],
        password=DB_CONFIG['password'],
        port=DB_CONFIG['port'],
        row_factory=dict_row
    )
    return conn

class AIEngine:
    """AI Engine to analyze traffic and propose solutions"""
    
    @staticmethod
    def analyze_scenario(trains):
        """Analyze train scenario and detect conflicts"""
        conflicts = []
        
        # Check for trains on same section
        section_trains = {}
        for train in trains:
            section = train['current_section']
            if section not in section_trains:
                section_trains[section] = []
            section_trains[section].append(train)
        
        # Detect conflicts
        for section, trains_in_section in section_trains.items():
            if len(trains_in_section) > 1:
                conflicts.append({
                    'type': 'same_section',
                    'section': section,
                    'trains': [t['train_id'] for t in trains_in_section]
                })
        
        return conflicts
    
    @staticmethod
    def generate_solutions(trains, conflicts):
        """Generate possible solutions for conflicts"""
        solutions = []
        
        if not conflicts:
            return [{
                'id': 1,
                'description': 'No conflicts detected. All trains operating normally.',
                'actions': [],
                'priority': 'low'
            }]
        
        for conflict in conflicts:
            if conflict['type'] == 'same_section':
                # Get trains involved in conflict
                conflict_trains = [t for t in trains if t['train_id'] in conflict['trains']]
                
                # Sort by priority (lower number = higher priority)
                conflict_trains.sort(key=lambda x: x['priority'])
                
                # Solution 1: Slow down lower priority trains
                solution_1 = {
                    'id': len(solutions) + 1,
                    'description': f"Reduce speed of lower priority trains on Section {conflict['section']}",
                    'actions': []
                }
                
                for train in conflict_trains[1:]:  # All except highest priority
                    solution_1['actions'].append({
                        'train_id': train['train_id'],
                        'action': 'reduce_speed',
                        'new_speed': max(20, train['current_speed'] - 30)
                    })
                
                solution_1['priority'] = 'high'
                solutions.append(solution_1)
                
                # Solution 2: Reroute lower priority train
                if len(conflict_trains) > 1:
                    solution_2 = {
                        'id': len(solutions) + 1,
                        'description': f"Reroute {conflict_trains[-1]['train_id']} to alternate track",
                        'actions': [{
                            'train_id': conflict_trains[-1]['train_id'],
                            'action': 'reroute',
                            'new_section': f"Section {chr(ord(conflict['section'][-1]) + 1)}"
                        }],
                        'priority': 'medium'
                    }
                    solutions.append(solution_2)
                
                # Solution 3: Stop lowest priority train temporarily
                solution_3 = {
                    'id': len(solutions) + 1,
                    'description': f"Hold {conflict_trains[-1]['train_id']} until section clears",
                    'actions': [{
                        'train_id': conflict_trains[-1]['train_id'],
                        'action': 'stop',
                        'new_speed': 0,
                        'duration': '5 minutes'
                    }],
                    'priority': 'low'
                }
                solutions.append(solution_3)
        
        return solutions

@app.route('/')
def index():
    """Serve the main page"""
    return render_template('index.html')

@app.route('/api/scenarios', methods=['GET'])
def get_scenarios():
    """Get all available scenarios"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    cur.execute('SELECT * FROM scenarios ORDER BY created_at DESC')
    scenarios = cur.fetchall()
    
    cur.close()
    conn.close()
    
    return jsonify(scenarios)

@app.route('/api/scenario/<int:scenario_id>', methods=['GET'])
def get_scenario(scenario_id):
    """Get a specific scenario with its trains"""
    conn = get_db_connection()
    cur = conn.cursor()
    
    # Get scenario
    cur.execute('SELECT * FROM scenarios WHERE scenario_id = %s', (scenario_id,))
    scenario = cur.fetchone()
    
    if not scenario:
        cur.close()
        conn.close()
        return jsonify({'error': 'Scenario not found'}), 404
    
    # Get trains
    cur.execute('SELECT * FROM trains WHERE scenario_id = %s', (scenario_id,))
    trains = cur.fetchall()
    
    cur.close()
    conn.close()
    
    return jsonify({
        'scenario': scenario,
        'trains': trains
    })

@app.route('/api/analyze', methods=['POST'])
def analyze_scenario():
    """Analyze current scenario and return AI solutions"""
    data = request.json
    trains = data.get('trains', [])
    
    # Detect conflicts
    conflicts = AIEngine.analyze_scenario(trains)
    
    # Generate solutions
    solutions = AIEngine.generate_solutions(trains, conflicts)
    
    return jsonify({
        'conflicts': conflicts,
        'solutions': solutions
    })

@app.route('/api/apply-solution', methods=['POST'])
def apply_solution():
    """Apply selected solution and return updated train states"""
    data = request.json
    solution = data.get('solution')
    trains = data.get('trains', [])
    
    # Apply actions from solution
    updated_trains = []
    for train in trains:
        updated_train = train.copy()
        
        for action in solution.get('actions', []):
            if action['train_id'] == train['train_id']:
                if action['action'] == 'reduce_speed':
                    updated_train['current_speed'] = action['new_speed']
                    updated_train['status'] = 'speed_reduced'
                elif action['action'] == 'reroute':
                    updated_train['current_section'] = action['new_section']
                    updated_train['status'] = 'rerouted'
                elif action['action'] == 'stop':
                    updated_train['current_speed'] = 0
                    updated_train['status'] = 'stopped'
        
        updated_trains.append(updated_train)
    
    return jsonify({'trains': updated_trains})

@app.route('/api/scenario', methods=['POST'])
def create_scenario():
    """Create a new custom scenario"""
    data = request.json
    
    conn = get_db_connection()
    cur = conn.cursor()
    
    # Insert scenario
    cur.execute(
        'INSERT INTO scenarios (name, description) VALUES (%s, %s) RETURNING scenario_id',
        (data['name'], data.get('description', ''))
    )
    scenario_id = cur.fetchone()['scenario_id']
    
    # Insert trains
    for train in data['trains']:
        cur.execute(
            '''INSERT INTO trains (scenario_id, train_id, train_type, priority, 
               current_speed, current_section, destination, distance_to_destination, status)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)''',
            (scenario_id, train['train_id'], train['train_type'], train['priority'],
             train['current_speed'], train['current_section'], train['destination'],
             train['distance_to_destination'], 'active')
        )
    
    conn.commit()
    cur.close()
    conn.close()
    
    return jsonify({'scenario_id': scenario_id, 'message': 'Scenario created successfully'})

if __name__ == '__main__':
    app.run(debug=True, port=5000)