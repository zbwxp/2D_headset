"""Isolated math tests; run python -m unittest discover -s scripts/authoring."""
import copy
import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location("fit_warp_grid", Path(__file__).with_name("fit-warp-grid.py"))
fitter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fitter)


def grid(rows=2, columns=2):
    nodes = []
    for r in range(rows+1):
        for c in range(columns+1):
            x, y = -1+2*c/columns, -1+2*r/rows
            nodes.append({"position": [x,y], "handleU": [x+2/columns/3,y], "handleV": [x,y+2/rows/3], "twist": [0,0]})
    return {"rows": rows, "columns": columns, "bounds": {"min": [-1,-1], "max": [1,1]}, "nodes": nodes}


def job(transform=lambda p: p):
    curves = [[[-.9,-.8],[-.3,.7],[.4,-.7],[.9,.8]], [[-.8,.9],[.6,.4],[-.6,-.4],[.8,-.9]]]
    return {"name":"test", "grid":grid(), "curvePairs":[{"sourceId":str(i),"source":c,"target":[transform(p) for p in c]} for i,c in enumerate(curves)], "pins":[{"sourcePoint":[0,0],"targetPoint":transform([0,0])}],"options":{"samplesPerCurve":65,"regularization":1e-12,"validationSamplesPerCurve":256}}


class ForwardWarpFitTests(unittest.TestCase):
    def test_identity_nonmutation(self):
        data = job()
        before = copy.deepcopy(data)
        result = fitter.fit_job(data)
        self.assertLess(result["diagnostics"]["maxError"], 1e-12)
        self.assertEqual(data, before)
        self.assertEqual(result["grid"]["bounds"], data["grid"]["bounds"])

    def test_affine_and_exact_pin(self):
        result = fitter.fit_job(job(lambda p:[1.2*p[0]+.3*p[1]+.4,-.2*p[0]+.8*p[1]-.1]))
        self.assertLess(result["diagnostics"]["maxError"], 1e-6)
        self.assertLess(result["diagnostics"]["maxPinResidual"], 1e-13)

    def test_singular_forward_map_allowed(self):
        result = fitter.fit_job(job(lambda p:[p[0]+.2,0]))
        self.assertLess(result["diagnostics"]["maxError"], 1e-6)
        self.assertEqual(result["diagnostics"]["foldPolicy"], "allowed; no inverse or injectivity assumption")

    def test_contradictory_pins_reject(self):
        data=job();data["pins"].append({"sourcePoint":[0,0],"targetPoint":[1,0]})
        with self.assertRaisesRegex(ValueError,"contradictory"):
            fitter.fit_job(data)

    def test_multiple_exact_pins_and_reported_soft_tangents(self):
        transform=lambda p:[1.3*p[0]-.2*p[1]+.4,.5*p[0]+.8*p[1]-.1]
        data=job(transform);data["options"]["endpointTangentWeight"]=.01
        data["pins"].append({"sourcePoint":[.3,-.4],"targetPoint":transform([.3,-.4])})
        result=fitter.fit_job(data)
        self.assertLess(result["diagnostics"]["maxPinResidual"],1e-13)
        self.assertLess(result["diagnostics"]["maxError"],1e-6)
        self.assertEqual(result["diagnostics"]["endpointTangentWeight"],.01)
        self.assertLess(result["diagnostics"]["endpointVelocityRmsError"],1e-6)

    def test_directional_basis_derivative_against_independent_differences(self):
        data=grid(3,4);rng=np.random.default_rng(7)
        for node in data["nodes"]:
            for key in fitter.CONTROL_KEYS:node[key]=rng.normal(0,1,2).tolist()
        points=np.array([[-.8,-.7],[-.2,.1],[.2,.7],[.7,-.2]])
        velocities=rng.normal(0,.3,points.shape);controls=fitter.grid_data(data)[-1];epsilon=1e-6
        actual=fitter.basis_matrix(data,points,velocities)@controls
        expected=(fitter.basis_matrix(data,points+epsilon*velocities)-fitter.basis_matrix(data,points-epsilon*velocities))@controls/(2*epsilon)
        np.testing.assert_allclose(actual,expected,atol=2e-9)

    def test_invalid_bounds_and_nonfinite_values(self):
        data=job();data["pins"][0]["sourcePoint"]=[2,0]
        with self.assertRaisesRegex(ValueError,"outside"):
            fitter.fit_job(data)
        data=job();data["curvePairs"][0]["target"][0][0]=float("nan")
        with self.assertRaisesRegex(ValueError,"finite"):
            fitter.fit_job(data)

    def test_absolute_control_basis_against_direct_hermite_jets(self):
        data=grid(3,4);rng=np.random.default_rng(42)
        for node in data["nodes"]:
            for key in fitter.CONTROL_KEYS:
                node[key]=(np.array(node[key])+rng.normal(0,.2,2)).tolist()
        points=np.r_[rng.uniform(-1,1,(200,2)),[[-1,-1],[1,1],[0,0]]]
        controls=fitter.grid_data(data)[-1]
        actual=fitter.basis_matrix(data,points)@controls
        for k,p in enumerate(points):
            uv=(p+1)*[2,1.5];cell=np.minimum(np.floor(uv).astype(int),[3,2]);u,v=uv-cell
            def h(t):return [2*t**3-3*t*t+1,-2*t**3+3*t*t,t**3-2*t*t+t,t**3-t*t]
            hu,hv=h(u),h(v);expected=np.zeros(2)
            for j in range(2):
                for i in range(2):
                    n=data["nodes"][(cell[1]+j)*5+cell[0]+i];pos=np.array(n["position"])
                    expected+=pos*hu[i]*hv[j]+3*(np.array(n["handleU"])-pos)*hu[i+2]*hv[j]+3*(np.array(n["handleV"])-pos)*hu[i]*hv[j+2]+np.array(n["twist"])*hu[i+2]*hv[j+2]
            np.testing.assert_allclose(actual[k],expected,atol=1e-13)


if __name__ == "__main__":
    unittest.main()
