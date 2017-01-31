import tornado.ioloop
import tornado.web

import networkx as nx
import json
import numpy as np
from weakref import WeakValueDictionary


class BaseHandler(tornado.web.RequestHandler):

    def initialize(self, G, sets, node2sets, threshold):
        self.G = G
        self.sets = sets
        self.node2sets = node2sets
        self.threshold = threshold

    def add_cors_headers(self):
        self.set_header("Access-Control-Allow-Origin", "*")
        self.set_header("Access-Control-Allow-Headers", "x-requested-with")
        self.set_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')

    def prepare(self):
        self.add_cors_headers()

class NodeHandler(BaseHandler):
    def get(self, u):
        #TODO(tartavull) add optional threshold argument
        u = int(u)
        if self.G.has_node(u):
            stack  = [u]
            visited = set()
            while len(stack):
                node = stack.pop()
                if node in visited:
                    continue

                # Here is some tricky code
                # if the node we chose is part of an object we include
                # all the nodes in that object
                # if we chose an element which is connected with higher
                # than threshold capacity to an object, we also include all
                # nodes in that object.
                # But we don't add the nodes of the objects to the stack, because
                # we don't want to search for the neighbors of this object, because we
                # asume that they are already correct.
                if node in self.node2sets:
                    visited = visited.union(self.node2sets[node])

                for e0, e1, data in self.G.edges_iter(nbunch=node,data=True):
                    visited.add(node)

                    capacity = data['capacity']
                    assert e0 == node
                    if capacity > self.threshold and e1 not in visited:
                        stack.append(e1)

            #TODO(tartavull) make this 64 bits once neuroglancer can handle it
            data = np.array(list(visited)).astype(np.uint32).tostring()
            self.write(data)

        else:
            self.clear()
            self.set_status(400)
            self.finish()

    def post(self, u):
        u = int(u)

        self.G.add_node(u)
        self.clear()
        self.set_status(200)
        self.finish()

    def delete(self, u):
        u = int(u)
        
        if self.G.has_node(u):
            self.G.remove_node(u)
            self.clear()
            self.set_status(200)
            self.finish()
        else:
            self.clear()
            self.set_status(400)
            self.finish()

class EdgeHandler(BaseHandler):
    def get(self, u, v):
        """        
        Args:
            u (int): node
            v (int): node
        
        Returns:
            JSON: properties of the edge
        """
        u = int(u); v = int(v)

        if self.G.has_edge(u,v):
            self.finish(json.dumps(self.G[u][v]))
        else:
            self.clear()
            self.set_status(400)
            self.finish()

    def post(self, u, v):
        u = int(u); v = int(v)
        self.G.add_edge(u,v, capacity=1.0) #TODO(tartavull) add capacity for min cut

    def delete(self, u, v):
        u = int(u); v = int(v)
        self.G.remove_edge(u,v)

class SplitHandler(BaseHandler):
    def post(self):
        data = json.loads(self.request.body)
        virtual_source = [ int(num) for num in data['sources'] ]
        virtual_sink = [ int(num) for num in data['sinks'] ]
        all_nodes = virtual_source + virtual_sink

        if set(virtual_source).intersection(set(virtual_sink)):
            self.set_status(400);
            self.finish(json.dumps({ 
                'error': u'Unable to split a single segment ID.' 
            }))
            return

        for node in all_nodes:
            if node not in self.node2sets:
                self.set_status(400)
                self.finish(json.dumps({ 
                    'error': str(node) + u' did not belong to any known object.',
                }))
                return

        first_set = self.node2sets[all_nodes[0]]
        for node in all_nodes:
            if first_set != self.node2sets[node]:
                self.set_status(400)
                self.finish(json.dumps({ 
                    'error': 'Selected objects were already split.'
                }))
                return

        # Virtual source and sinks allow for many sources and
        # many sinks. It simply creates a new node that represents all the sources
        # and equivanlently for the sinks allowing for seemless operation of the standard
        # max flow algorithm that uses a single source and sink.


        # this set might contain disconected subgraph, despite that nx.minimum_cut 
        # is able to spit them apart
        H = self.G.subgraph(list(first_set))

        H.add_node('virtual_source')
        for u in virtual_source:
            H.add_edge('virtual_source', u) #The edge is considered to have infinite capacity

        H.add_node('virtual_sink')
        for v in virtual_sink:
            H.add_edge('virtual_sink', v) #The edge is considered to have infinite capacity


        cut_value, partitions = nx.minimum_cut(H, 'virtual_sink', 'virtual_source')
        partitions[0].remove('virtual_sink')
        partitions[1].remove('virtual_source')
        partitions = map(lambda x: map(int,x), partitions)

        # update objects based on new partions
        del self.sets[self.sets.index(object_set)]
        
        first_set = set(partitions[0])
        self.sets.append(first_set)
        for node in first_set:
            self.node2sets[node] = first_set

        second_set = set(partitions[1])
        self.sets.append(second_set)
        for node in second_set:
            self.node2sets[node] = second_set

        self.finish(json.dumps(partitions))


class ObjectHandler(BaseHandler):
    """It treats a set of supervoxels as an object.
       It will merge objects into a new one if a new object is post that
       contains at least one member of an already existent object.

       This is completly independent of the global region graph. When an object
       is created this doesn't check if the provided nodes ids actually exist in
       the global graph.
    """

    def get(self):
        self.write(json.dumps(map(list,self.sets)))

    def post(self):
        nodes = tornado.escape.json_decode(self.request.body)
        nodes = map(int, nodes)
        new_set = set(nodes)
        for node in nodes:
            if node in self.node2sets:
                new_set = new_set.union(self.node2sets[node])
                self.sets.remove(self.node2sets[node])
        for node in nodes:
            self.node2sets[node] = new_set
        self.sets.append(new_set)
        
        self.set_status(200)
        self.finish()



def make_app(test=False):
    if not test:
        G = nx.read_gpickle('snemi3d_graph.pickle')
        print 'graph restored'
    else:
        G = nx.Graph()

    def threshold_graph(G):
        for edge in G.edges_iter(data=True):
            u, v, data = edge
            if float(data['capacity']) < 0.8: #threshold for removing edges
                G.remove_edge(u,v)

    threshold_graph(G)

    args =  {
        'G': G,
        'sets': [],
        'node2sets': WeakValueDictionary(),
        'threshold': 0.8
    }

    app = tornado.web.Application([
        (r'/1.0/node/(\d+)/?', NodeHandler, args),
        (r'/1.0/edge/(\d+)/(\d+)/?', EdgeHandler, args),
        (r'/1.0/split/?', SplitHandler, args),
        (r'/1.0/object/?', ObjectHandler, args),
    ], debug=True)

    app.args = args
    return app


if __name__ == '__main__':
    app = make_app()
    app.listen(8888)
    tornado.ioloop.IOLoop.current().start()